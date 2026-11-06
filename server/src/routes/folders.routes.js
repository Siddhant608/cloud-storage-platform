
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
// 4. DELETE EMPTY FOLDER
// DELETE /api/folders/:id
// ==========================================

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

    const existing = await client.query(
      `SELECT id, owner_id, folder_name
       FROM folders
       WHERE id = $1
       FOR UPDATE`,
      [folderId]
    );

    if (existing.rowCount !== 1) {
      throw fail(404, "Folder not found.");
    }

    if (existing.rows[0].owner_id !== req.userId) {
      throw fail(403, "Only the folder owner can delete it.");
    }

    const children = await client.query(
      `SELECT id
       FROM folders
       WHERE parent_folder_id = $1
       LIMIT 1`,
      [folderId]
    );

    if (children.rowCount > 0) {
      throw fail(409, "Cannot delete a folder containing subfolders.");
    }

    const files = await client.query(
      `SELECT id
       FROM files
       WHERE folder_id = $1
         AND deleted_at IS NULL
       LIMIT 1`,
      [folderId]
    );

    if (files.rowCount > 0) {
      throw fail(409, "Folder is not empty. Move or delete its files first.");
    }

    await logFolderActivity(
      client,
      req.userId,
      "FOLDER_DELETED",
      folderId,
      existing.rows[0].folder_name
    );

    await client.query(
      "DELETE FROM folders WHERE id = $1",
      [folderId]
    );

    await client.query("COMMIT");
    inTransaction = false;

    return res.status(200).json({
      message: "Empty folder deleted successfully."
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
