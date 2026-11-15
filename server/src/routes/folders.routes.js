
import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function logFolderActivity(client, userId, action, folderId, folderName) {
  await client.query(
    `INSERT INTO activity_logs
       (actor_user_id, action, metadata)
     VALUES ($1, $2, $3::jsonb)`,
    [
      userId,
      action,
      JSON.stringify({ folderId, folderName })
    ]
  );
}

// ==========================================
// 1. CREATE FOLDER
// POST /api/folders
// ==========================================

router.post("/", requireAuth, async (req, res, next) => {
  let client;
  let inTransaction = false;

  try {
    const { folderName, parentFolderId = null } = req.body ?? {};

    if (typeof folderName !== "string") {
      throw fail(400, "Folder name is required.");
    }

    const name = folderName.trim();

    if (!name || name.length > 255) {
      throw fail(400, "Folder name must contain 1 to 255 characters.");
    }

    if (
      parentFolderId !== null &&
      (typeof parentFolderId !== "string" ||
        !UUID_RE.test(parentFolderId))
    ) {
      throw fail(400, "Invalid parent folder ID.");
    }

    client = await pool.connect();
    await client.query("BEGIN");
    inTransaction = true;

    if (parentFolderId) {
      const parent = await client.query(
        `SELECT id, owner_id
         FROM folders
         WHERE id = $1
         FOR UPDATE`,
        [parentFolderId]
      );

      if (parent.rowCount !== 1) {
        throw fail(404, "Parent folder not found.");
      }

      if (parent.rows[0].owner_id !== req.userId) {
        throw fail(403, "Only the folder owner can create a subfolder.");
      }
    }

    const result = await client.query(
      `INSERT INTO folders
         (owner_id, parent_folder_id, folder_name)
       VALUES ($1, $2, $3)
       RETURNING id, owner_id, parent_folder_id, folder_name, created_at`,
      [req.userId, parentFolderId, name]
    );

    const folder = result.rows[0];

    await logFolderActivity(
      client, req.userId, "FOLDER_CREATED", folder.id, name
    );

    await client.query("COMMIT");
    inTransaction = false;

    return res.status(201).json({
      message: "Folder created successfully.",
      folder
    });
  } catch (error) {
    if (client && inTransaction) {
      await client.query("ROLLBACK").catch(() => {});
    }
    return next(error);
  } finally {
    client?.release();
  }
});

// ==========================================
// 2. LIST FOLDERS
// GET /api/folders
// ==========================================

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         f.id,
         f.owner_id,
         f.parent_folder_id,
         f.folder_name,
         f.created_at,
         CASE
           WHEN f.owner_id = $1 THEN 'owner'
           ELSE fm.role
         END AS role
       FROM folders f
       LEFT JOIN folder_members fm
         ON fm.folder_id = f.id
        AND fm.user_id = $1
       WHERE f.owner_id = $1 OR fm.user_id = $1
       ORDER BY f.created_at DESC`,
      [req.userId]
    );

    return res.status(200).json({
      folders: result.rows
    });
  } catch (error) {
    return next(error);
  }
});

// ==========================================
// 3. RENAME FOLDER
// PATCH /api/folders/:id
// ==========================================

router.patch("/:id", requireAuth, async (req, res, next) => {
  let client;
  let inTransaction = false;

  try {
    const folderId = req.params.id;
    const { folderName } = req.body ?? {};

    if (!UUID_RE.test(folderId)) {
      throw fail(400, "Invalid folder ID.");
    }

    if (typeof folderName !== "string") {
      throw fail(400, "New folder name is required.");
    }

    const name = folderName.trim();

    if (!name || name.length > 255) {
      throw fail(400, "Folder name must contain 1 to 255 characters.");
    }

    client = await pool.connect();
    await client.query("BEGIN");
    inTransaction = true;

    const existing = await client.query(
      `SELECT id, owner_id
       FROM folders
       WHERE id = $1
       FOR UPDATE`,
      [folderId]
    );

    if (existing.rowCount !== 1) {
      throw fail(404, "Folder not found.");
    }

    if (existing.rows[0].owner_id !== req.userId) {
      throw fail(403, "Only the folder owner can rename it.");
    }

    const result = await client.query(
      `UPDATE folders
       SET folder_name = $1
       WHERE id = $2
       RETURNING id, owner_id, parent_folder_id, folder_name, created_at`,
      [name, folderId]
    );

    await logFolderActivity(
      client, req.userId, "FOLDER_RENAMED", folderId, name
    );

    await client.query("COMMIT");
    inTransaction = false;

    return res.status(200).json({
      message: "Folder renamed successfully.",
      folder: result.rows[0]
    });
  } catch (error) {
    if (client && inTransaction) {
      await client.query("ROLLBACK").catch(() => {});
    }
    return next(error);
  } finally {
    client?.release();
  }
});

// ==========================================
// 4. DELETE FOLDER TREE
// DELETE /api/folders/:id
// Moves owned active files to Trash, then removes the folder tree.
// File versions remain intact.

router.delete("/:id", requireAuth, async (req, res, next) => {
  let client;
  let inTransaction = false;

  try {
    const folderId = req.params.id;

    if (!UUID_RE.test(folderId)) {
      throw fail(400, "Invalid folder ID.");
    }

    client = await pool.connect();
    await client.query("BEGIN");
    inTransaction = true;

    // Find and lock the complete folder tree, deepest folders first.
    const treeResult = await client.query(
      `WITH RECURSIVE folder_tree AS (
         SELECT
           id,
           owner_id,
           parent_folder_id,
           folder_name,
           0 AS depth
         FROM folders
         WHERE id = $1

         UNION ALL

         SELECT
           child.id,
           child.owner_id,
           child.parent_folder_id,
           child.folder_name,
           parent.depth + 1
         FROM folders child
         JOIN folder_tree parent
           ON child.parent_folder_id = parent.id
       )
       SELECT
         f.id,
         f.owner_id,
         f.folder_name,
         tree.depth
       FROM folder_tree tree
       JOIN folders f ON f.id = tree.id
       ORDER BY tree.depth DESC, f.id
       FOR UPDATE OF f`,
      [folderId]
    );

    if (treeResult.rowCount === 0) {
      throw fail(404, "Folder not found.");
    }

    const rootFolder = treeResult.rows.find(
      folder => folder.id === folderId
    );

    if (!rootFolder || rootFolder.owner_id !== req.userId) {
      throw fail(403, "Only the folder owner can delete it.");
    }

    const folderIds = treeResult.rows.map(folder => folder.id);

    // Do not remove folders owned by another user.
    const foreignFolder = treeResult.rows.find(
      folder => folder.owner_id !== req.userId
    );

    if (foreignFolder) {
      throw fail(
        409,
        "Cannot delete this folder because a nested folder belongs to another user."
      );
    }

    // Lock active files in the tree and protect files owned by others.
    const foreignFiles = await client.query(
      `SELECT id
       FROM files
       WHERE folder_id = ANY($1::uuid[])
         AND deleted_at IS NULL
         AND owner_id <> $2
       FOR UPDATE`,
      [folderIds, req.userId]
    );

    if (foreignFiles.rowCount > 0) {
      throw fail(
        409,
        "Cannot delete this folder because it contains active files owned by another user."
      );
    }

    // Lock the current user's active files in the folder tree.
    const ownedFiles = await client.query(
      `SELECT id, display_name
       FROM files
       WHERE folder_id = ANY($1::uuid[])
         AND owner_id = $2
         AND deleted_at IS NULL
       FOR UPDATE`,
      [folderIds, req.userId]
    );

    const fileIds = ownedFiles.rows.map(file => file.id);

    if (fileIds.length > 0) {
      // Soft-delete files. Their versions remain available in Trash.
      await client.query(
        `UPDATE files
         SET deleted_at = NOW(),
             updated_at = NOW()
         WHERE id = ANY($1::uuid[])
           AND owner_id = $2
           AND deleted_at IS NULL`,
        [fileIds, req.userId]
      );

      // Revoke active private shares.
      await client.query(
        `UPDATE file_shares
         SET revoked_at = NOW()
         WHERE file_id = ANY($1::uuid[])
           AND revoked_at IS NULL`,
        [fileIds]
      );

      // Revoke active public share links.
      await client.query(
        `UPDATE share_links
         SET revoked_at = NOW()
         WHERE file_id = ANY($1::uuid[])
           AND revoked_at IS NULL`,
        [fileIds]
      );

      // Record an activity entry for every file moved to Trash.
      await client.query(
        `INSERT INTO activity_logs
           (actor_user_id, action, file_id, metadata)
         SELECT
           $1,
           'FILE_DELETED',
           f.id,
           jsonb_build_object(
             'fileName', f.display_name,
             'deletionType', 'soft_delete',
             'source', 'folder_delete'
           )
         FROM files f
         WHERE f.id = ANY($2::uuid[])`,
        [req.userId, fileIds]
      );
    }

    // Record deletion of every folder in the tree.
    for (const folder of treeResult.rows) {
      await logFolderActivity(
        client,
        req.userId,
        "FOLDER_DELETED",
        folder.id,
        folder.folder_name
      );
    }

    // Delete deepest folders first to satisfy the parent-folder FK.
    for (const folder of treeResult.rows) {
      await client.query(
        "DELETE FROM folders WHERE id = $1",
        [folder.id]
      );
    }

    await client.query("COMMIT");
    inTransaction = false;

    return res.status(200).json({
      message: `Folder "${rootFolder.folder_name}" and its contents were deleted. Owned files were moved to Trash.`,
      deletedFolderCount: folderIds.length,
      trashedFileCount: fileIds.length
    });
  } catch (error) {
    if (client && inTransaction) {
      await client.query("ROLLBACK").catch(() => {});
    }
    return next(error);
  } finally {
    client?.release();
  }
});
export default router;
