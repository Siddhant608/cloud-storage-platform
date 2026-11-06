
import { Router } from "express";
import multer from "multer";
import {
  createHash,
  randomUUID,
  randomBytes
} from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

const tempDir = path.join(serverDir, "storage", "tmp");
const blobDir = path.join(serverDir, "storage", "blobs");

await fs.mkdir(tempDir, { recursive: true });
await fs.mkdir(blobDir, { recursive: true });

// Multer configuration
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tempDir),
    filename: (_req, _file, cb) => cb(null, randomUUID())
  }),
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 1
  }
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_RETRIES = 50;

const sleep = (ms) =>
  new Promise(resolve => setTimeout(resolve, ms));
// Error helper
function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// Upload middleware
function receiveFile(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError) {
        error.statusCode =
          error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      }

      return next(error);
    }

    next();
  });
}

// Safely obtain the display filename
function displayName(req) {
  const raw =
    typeof req.body?.displayName === "string"
      ? req.body.displayName
      : req.file?.originalname;

  if (typeof raw !== "string") {
    throw fail(400, "A file name is required.");
  }

  const name = raw
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();

  if (!name || name.length > 255) {
    throw fail(400, "File name must contain 1 to 255 characters.");
  }

  return name;
}

// Calculate SHA-256 checksum
async function sha256(filePath) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

// Reserve storage quota atomically
async function reserveQuota(userId, bytes) {
  const result = await pool.query(
    `UPDATE storage_usage
     SET reserved_bytes = reserved_bytes + $1
     WHERE user_id = $2
       AND used_bytes + reserved_bytes + $1 <= quota_bytes
     RETURNING user_id`,
    [bytes, userId]
  );

  if (result.rowCount !== 1) {
    throw fail(
      413,
      "Storage quota exceeded or quota record is missing."
    );
  }
}

// Release reservation after failure
async function releaseQuota(userId, bytes) {
  await pool.query(
    `UPDATE storage_usage
     SET reserved_bytes = GREATEST(reserved_bytes - $1, 0)
     WHERE user_id = $2`,
    [bytes, userId]
  );
}

// Convert reserved storage into used storage
async function finalizeQuota(client, userId, bytes) {
  const result = await client.query(
    `UPDATE storage_usage
     SET reserved_bytes = reserved_bytes - $1,
         used_bytes = used_bytes + $1
     WHERE user_id = $2
       AND reserved_bytes >= $1
     RETURNING user_id`,
    [bytes, userId]
  );

  if (result.rowCount !== 1) {
    throw new Error("Could not finalize storage reservation.");
  }
}

// Check file ownership or sharing permission
async function fileAccess(fileId, userId, db = pool) {
  const result = await db.query(
    `SELECT f.id, f.owner_id, f.display_name,
            CASE
              WHEN f.owner_id = $2 THEN 'owner'
              ELSE s.role
            END AS role
     FROM files f
     LEFT JOIN file_shares s
       ON s.file_id = f.id
      AND s.shared_with_user_id = $2
      AND s.revoked_at IS NULL
     WHERE f.id = $1
       AND f.deleted_at IS NULL
       AND (f.owner_id = $2 OR s.id IS NOT NULL)
     LIMIT 1`,
    [fileId, userId]
  );

  return result.rows[0] ?? null;
}

// Resolve a private blob path safely
function blobPathFor(blobKey) {
  if (!UUID_RE.test(blobKey)) {
    throw fail(500, "Invalid stored blob key.");
  }

  return path.join(blobDir, blobKey);
}// Hash a public share token before database lookup.
function hashShareToken(token) {
  if (
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{40,100}$/.test(token)
  ) {
    throw fail(400, "Invalid share token.");
  }

  return createHash("sha256")
    .update(token)
    .digest("hex");
}

// Find a valid public share link.
async function getActiveShareLink(token, db = pool) {
  const tokenHash = hashShareToken(token);

  const result = await db.query(
    `SELECT
       sl.id AS link_id,
       sl.file_id,
       sl.permission,
       sl.expires_at,
       f.owner_id,
       f.display_name
     FROM share_links sl
     JOIN files f ON f.id = sl.file_id
     WHERE sl.token_hash = $1
       AND sl.revoked_at IS NULL
       AND (sl.expires_at IS NULL OR sl.expires_at > NOW())
       AND f.deleted_at IS NULL
     LIMIT 1`,
    [tokenHash]
  );

  return result.rows[0] ?? null;
}

// Insert activity event inside a transaction
async function activity(
  client,
  userId,
  fileId,
  versionId,
  versionNo,
  action = "VERSION_CREATED",
  extraMetadata = {}
) {
  await client.query(
    `INSERT INTO activity_logs
       (actor_user_id, action, file_id, version_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      userId,
      action,
      fileId,
      versionId,
      JSON.stringify({
        versionNo,
        ...extraMetadata
      })
    ]
  );
}

// Delete temporary files safely
async function cleanup(filePath) {
  if (filePath) {
    await fs.rm(filePath, { force: true }).catch(() => {});
  }
}

// Generate a fingerprint for a logical upload
function uploadFingerprint(payload) {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

// Read and validate the idempotency key
function getIdempotencyKey(req) {
  const key = req.get("Idempotency-Key")?.trim();

  if (!key || key.length > 255) {
    throw fail(
      400,
      "A valid Idempotency-Key header is required."
    );
  }

  return key;
}

// Claim an upload request or recognize a retry
async function claimUploadRequest(
  userId,
  key,
  fingerprint
) {
  const inserted = await pool.query(
    `INSERT INTO upload_requests
       (uploader_id, idempotency_key, request_payload_hash, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (uploader_id, idempotency_key)
     DO NOTHING
     RETURNING id`,
    [userId, key, fingerprint]
  );

  if (inserted.rowCount === 1) {
    return {
      requestId: inserted.rows[0].id,
      completed: null
    };
  }

  const existingResult = await pool.query(
    `SELECT id, request_payload_hash, status
     FROM upload_requests
     WHERE uploader_id = $1 AND idempotency_key = $2`,
    [userId, key]
  );

  const existing = existingResult.rows[0];

  if (!existing) {
    throw new Error("Could not retrieve upload request.");
  }

  if (existing.request_payload_hash !== fingerprint) {
    throw fail(
      409,
      "This idempotency key was already used for different content."
    );
  }

  if (existing.status === "completed") {
    return {
      requestId: existing.id,
      completed: await readCompletedUpload(existing.id)
    };
  }

  if (existing.status === "pending") {
    throw fail(
      409,
      "This logical upload is already in progress. Retry using the same key later."
    );
  }

  // Allow another attempt after a previous failed attempt.
  const claimed = await pool.query(
    `UPDATE upload_requests
     SET status = 'pending',
         file_id = NULL,
         version_id = NULL
     WHERE id = $1 AND status = 'failed'
     RETURNING id`,
    [existing.id]
  );

  if (claimed.rowCount !== 1) {
    throw fail(409, "Upload request is already being processed.");
  }

  return {
    requestId: existing.id,
    completed: null
  };
}

// Retrieve the already committed result
async function readCompletedUpload(requestId) {
  const result = await pool.query(
    `SELECT
       f.id AS file_id,
       f.owner_id,
       f.display_name,
       f.created_at AS file_created_at,
       v.id AS version_id,
       v.version_no,
       v.size_bytes,
       v.checksum_sha256,
       v.uploaded_at
     FROM upload_requests ur
     JOIN files f ON f.id = ur.file_id
     JOIN file_versions v ON v.id = ur.version_id
     WHERE ur.id = $1 AND ur.status = 'completed'`,
    [requestId]
  );

  if (result.rowCount !== 1) {
    throw new Error("Completed upload result could not be retrieved.");
  }

  const row = result.rows[0];

  return {
    file: {
      id: row.file_id,
      owner_id: row.owner_id,
      display_name: row.display_name,
      created_at: row.file_created_at
    },
    version: {
      id: row.version_id,
      file_id: row.file_id,
      version_no: row.version_no,
      size_bytes: row.size_bytes,
      checksum_sha256: row.checksum_sha256,
      uploaded_at: row.uploaded_at
    }
  };
}

// Mark a request complete inside the upload transaction
async function completeUploadRequest(
  client,
  requestId,
  fileId,
  versionId
) {
  const result = await client.query(
    `UPDATE upload_requests
     SET file_id = $1,
         version_id = $2,
         status = 'completed'
     WHERE id = $3 AND status = 'pending'`,
    [fileId, versionId, requestId]
  );

  if (result.rowCount !== 1) {
    throw new Error("Could not finalize idempotency record.");
  }
}

// Mark an unsuccessful attempt as failed
async function markUploadRequestFailed(requestId) {
  await pool.query(
    `UPDATE upload_requests
     SET status = 'failed'
     WHERE id = $1 AND status = 'pending'`,
    [requestId]
  );
}


// ==========================================
// 1. UPLOAD NEW FILE
// POST /api/files
// ==========================================


router.post("/", requireAuth, receiveFile, async (req, res, next) => {
  let reserved = false;
  let savedBlobPath = null;
  let client = null;
  let requestId = null;

  try {
    if (!req.file) {
      throw fail(400, "Upload one file using the multipart field named 'file'.");
    }

    const userId = req.userId;
    const name = displayName(req);
    const bytes = req.file.size;
    const checksum = await sha256(req.file.path);

    // Require an idempotency key for each logical upload.
    const key = getIdempotencyKey(req);

    const fingerprint = uploadFingerprint({
      operation: "create-file",
      displayName: name,
      sizeBytes: bytes,
      checksum
    });

    // Claim the logical upload request.
    const claim = await claimUploadRequest(
      userId,
      key,
      fingerprint
    );

    requestId = claim.requestId;

    // A retry of an already completed upload returns its old result.
    if (claim.completed) {
      return res.status(200).json({
        message: "This upload was already completed.",
        ...claim.completed
      });
    }

    // Reserve quota atomically.
    await reserveQuota(userId, bytes);
    reserved = true;

    // Store the actual file using a unique immutable key.
    const blobKey = randomUUID();

    savedBlobPath = blobPathFor(blobKey);
    await fs.rename(req.file.path, savedBlobPath);

    client = await pool.connect();

    await client.query("BEGIN");

    // Create logical file record.
    const fileResult = await client.query(
      `INSERT INTO files (owner_id, display_name)
       VALUES ($1, $2)
       RETURNING id, owner_id, display_name, created_at`,
      [userId, name]
    );

    const file = fileResult.rows[0];

    // First upload always receives Version 1.
    const versionResult = await client.query(
      `INSERT INTO file_versions
         (file_id, version_no, uploader_id, blob_key,
          size_bytes, checksum_sha256, content_type)
       VALUES ($1, 1, $2, $3, $4, $5, $6)
       RETURNING id, file_id, version_no, size_bytes,
                 checksum_sha256, uploaded_at`,
      [
        file.id,
        userId,
        blobKey,
        bytes,
        checksum,
        req.file.mimetype || "application/octet-stream"
      ]
    );

    const version = versionResult.rows[0];

    await finalizeQuota(client, userId, bytes);

    await activity(client, userId, file.id, version.id, 1);

    // Save the result of this logical upload in the same transaction.
    await completeUploadRequest(
      client,
      requestId,
      file.id,
      version.id
    );

    await client.query("COMMIT");

    reserved = false;
    savedBlobPath = null;

    return res.status(201).json({
      message: "File uploaded successfully.",
      file,
      version
    });

  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    if (savedBlobPath) {
      await cleanup(savedBlobPath);
    }

    if (reserved) {
      await releaseQuota(
        req.userId,
        req.file?.size ?? 0
      ).catch(() => {});
    }

    if (requestId) {
      await markUploadRequestFailed(requestId).catch(() => {});
    }

    return next(error);

  } finally {
    client?.release();
    await cleanup(req.file?.path);
  }
});

// ==========================================
// 2. LIST USER FILES
// GET /api/files
// ==========================================

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         f.id,
         f.owner_id,
         f.folder_id,
         f.display_name,
         f.created_at,
         f.updated_at,
         latest.version_no AS latest_version,
         latest.size_bytes AS latest_size_bytes
       FROM files f
       LEFT JOIN file_shares s
         ON s.file_id = f.id
        AND s.shared_with_user_id = $1
        AND s.revoked_at IS NULL
       LEFT JOIN LATERAL (
         SELECT version_no, size_bytes
         FROM file_versions
         WHERE file_id = f.id
         ORDER BY version_no DESC
         LIMIT 1
       ) latest ON TRUE
       WHERE f.deleted_at IS NULL
         AND (f.owner_id = $1 OR s.id IS NOT NULL)
       ORDER BY f.updated_at DESC`,
      [req.userId]
    );

    return res.json({
      files: result.rows
    });

  } catch (error) {
    return next(error);
  }
});

// ==========================================
// 3. UPLOAD NEW VERSION
// POST /api/files/:id/versions
// ==========================================


router.post(
  "/:id/versions",
  requireAuth,
  receiveFile,
  async (req, res, next) => {
    let reserved = false;
    let savedBlobPath = null;
    let requestId = null;

    try {
      if (!UUID_RE.test(req.params.id)) {
        throw fail(400, "Invalid file ID.");
      }

      if (!req.file) {
        throw fail(400, "Upload one file using the multipart field named 'file'.");
      }

      const fileId = req.params.id;
      const userId = req.userId;
      const bytes = req.file.size;
      const checksum = await sha256(req.file.path);
      const name = displayName(req);

      const access = await fileAccess(fileId, userId);

      if (!access) {
        throw fail(404, "File not found or you do not have access.");
      }

      if (access.role === "viewer") {
        throw fail(403, "Viewer access cannot upload new versions.");
      }

      // Require an idempotency key.
      const key = getIdempotencyKey(req);

      const fingerprint = uploadFingerprint({
        operation: "new-version",
        fileId,
        displayName: name,
        sizeBytes: bytes,
        checksum
      });

      // Claim this logical upload.
      const claim = await claimUploadRequest(
        userId,
        key,
        fingerprint
      );

      requestId = claim.requestId;

      // Return the original result for an already completed retry.
      if (claim.completed) {
        return res.status(200).json({
          message: "This upload was already completed.",
          ...claim.completed
        });
      }

      // Reserve quota.
      await reserveQuota(userId, bytes);
      reserved = true;

      // One unique immutable blob for this logical upload.
      const blobKey = randomUUID();

      savedBlobPath = blobPathFor(blobKey);
      await fs.rename(req.file.path, savedBlobPath);

      let createdVersion = null;

      // Retry version conflicts a bounded number of times.
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        const client = await pool.connect();

        try {
          await client.query("BEGIN");

          // Verify access again inside the transaction.
          const currentAccess = await fileAccess(
            fileId,
            userId,
            client
          );

          if (!currentAccess) {
            throw fail(404, "File not found or access was revoked.");
          }

          if (currentAccess.role === "viewer") {
            throw fail(403, "Viewer access cannot upload new versions.");
          }

          // Allocate the next version number.
          const result = await client.query(
            `INSERT INTO file_versions
               (file_id, version_no, uploader_id, blob_key,
                size_bytes, checksum_sha256, content_type)
             SELECT
               $1,
               COALESCE(MAX(version_no), 0) + 1,
               $2, $3, $4, $5, $6
             FROM file_versions
             WHERE file_id = $1
             RETURNING id, file_id, version_no, size_bytes,
                       checksum_sha256, uploaded_at`,
            [
              fileId,
              userId,
              blobKey,
              bytes,
              checksum,
              req.file.mimetype || "application/octet-stream"
            ]
          );

          const version = result.rows[0];

          // Finalize quota within the same transaction.
          await finalizeQuota(client, userId, bytes);

          // Add the activity event.
          await activity(
            client,
            userId,
            fileId,
            version.id,
            version.version_no
          );

          // Complete the idempotency request atomically.
          await completeUploadRequest(
            client,
            requestId,
            fileId,
            version.id
          );

          await client.query("COMMIT");

          createdVersion = version;
          break;

        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});

          if (
            error.code === "23505" &&
            error.constraint === "unique_file_version" &&
            attempt < MAX_RETRIES
          ) {
            const delay =
              Math.min(200, attempt * 10) +
              Math.floor(Math.random() * 30);

            await sleep(delay);
            continue;
          }

          if (
            error.code === "23505" &&
            error.constraint === "unique_file_version"
          ) {
            break;
          }

          throw error;

        } finally {
          client.release();
        }
      }

      if (!createdVersion) {
        throw fail(
          409,
          "Version allocation conflicted repeatedly. Retry this upload."
        );
      }

      reserved = false;
      savedBlobPath = null;

      return res.status(201).json({
        message: "New version uploaded successfully.",
        fileId,
        version: createdVersion
      });

    } catch (error) {
      if (savedBlobPath) {
        await cleanup(savedBlobPath);
      }

      if (reserved) {
        await releaseQuota(
          req.userId,
          req.file?.size ?? 0
        ).catch(() => {});
      }

      if (requestId) {
        await markUploadRequestFailed(requestId).catch(() => {});
      }

      return next(error);

    } finally {
      await cleanup(req.file?.path);
    }
  }
);

// ==========================================
// 4. VIEW VERSION HISTORY
// GET /api/files/:id/versions
// ==========================================

 // ==========================================
 // VIEW VERSION HISTORY
 // GET /api/files/:id/versions
 // ==========================================

router.get("/:id/versions", requireAuth, async (req, res, next) => {
  try {
    const fileId = req.params.id;

    if (!UUID_RE.test(fileId)) {
      throw fail(400, "Invalid file ID.");
    }

    // Check whether the user owns or can access the file.
    const access = await fileAccess(fileId, req.userId);

    if (!access) {
      throw fail(404, "File not found or you do not have access.");
    }

    // Retrieve all versions, newest first.
    const result = await pool.query(
      `SELECT
         v.id,
         v.version_no,
         v.uploader_id,
         u.full_name AS uploader_name,
         v.size_bytes,
         v.checksum_sha256,
         v.content_type,
         v.uploaded_at
       FROM file_versions v
       JOIN users u ON u.id = v.uploader_id
       WHERE v.file_id = $1
       ORDER BY v.version_no DESC`,
      [fileId]
    );

    return res.status(200).json({
      file: access,
      versions: result.rows
    });

  } catch (error) {
    return next(error);
  }
});


 // ==========================================
 // 4. FILE SHARING
 // ==========================================


 // GET /api/files/:id/shares
 // View all active shares of a file.
 // Only the owner can manage/view the share list.

 router.get("/:id/shares", requireAuth, async (req, res, next) => {
   try {
     const fileId = req.params.id;

     if (!UUID_RE.test(fileId)) {
       throw fail(400, "Invalid file ID.");
     }

     const fileResult = await pool.query(
       `SELECT id, owner_id
        FROM files
        WHERE id = $1 AND deleted_at IS NULL`,
       [fileId]
     );

     if (fileResult.rowCount !== 1) {
       throw fail(404, "File not found.");
     }

     if (fileResult.rows[0].owner_id !== req.userId) {
       throw fail(403, "Only the file owner can view its share list.");
     }

     const result = await pool.query(
       `SELECT
          s.id AS share_id,
          u.id AS user_id,
          u.full_name,
          u.email,
          s.role,
          s.granted_by,
          s.created_at
        FROM file_shares s
        JOIN users u ON u.id = s.shared_with_user_id
        WHERE s.file_id = $1
          AND s.revoked_at IS NULL
        ORDER BY s.created_at DESC`,
       [fileId]
     );

     return res.status(200).json({
       fileId,
       shares: result.rows
     });

   } catch (error) {
     return next(error);
   }
 });


 // POST /api/files/:id/shares
 // Share a file with another registered user.

 router.post("/:id/shares", requireAuth, async (req, res, next) => {
   let client;

   try {
     const fileId = req.params.id;
     const { email, role } = req.body ?? {};

     if (!UUID_RE.test(fileId)) {
       throw fail(400, "Invalid file ID.");
     }

     if (typeof email !== "string" || typeof role !== "string") {
       throw fail(400, "Email and role are required.");
     }

     const normalizedEmail = email.trim().toLowerCase();
     const normalizedRole = role.trim().toLowerCase();

     if (
       !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
       normalizedEmail.length > 255
     ) {
       throw fail(400, "Please enter a valid email address.");
     }

     if (!["viewer", "editor"].includes(normalizedRole)) {
       throw fail(400, "Role must be viewer or editor.");
     }

     client = await pool.connect();

     await client.query("BEGIN");

     // Lock the file row to serialize share-management operations.
     const fileResult = await client.query(
       `SELECT id, owner_id
        FROM files
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE`,
       [fileId]
     );

     if (fileResult.rowCount !== 1) {
       throw fail(404, "File not found.");
     }

     if (fileResult.rows[0].owner_id !== req.userId) {
       throw fail(403, "Only the file owner can share this file.");
     }

     // Find the registered recipient.
     const userResult = await client.query(
       `SELECT id, full_name, email
        FROM users
        WHERE email_normalized = $1`,
       [normalizedEmail]
     );

     if (userResult.rowCount !== 1) {
       throw fail(404, "No registered user found with this email.");
     }

     const recipient = userResult.rows[0];

     if (recipient.id === req.userId) {
       throw fail(400, "You cannot share a file with yourself.");
     }

     // Prevent duplicate active sharing records.
     const existingShare = await client.query(
       `SELECT id
        FROM file_shares
        WHERE file_id = $1
          AND shared_with_user_id = $2
          AND revoked_at IS NULL`,
       [fileId, recipient.id]
     );

     if (existingShare.rowCount > 0) {
       throw fail(409, "This user already has access to the file.");
     }

     // Create the permission record.
     const shareResult = await client.query(
       `INSERT INTO file_shares
          (file_id, shared_with_user_id, role, granted_by)
        VALUES ($1, $2, $3, $4)
        RETURNING id, file_id, shared_with_user_id,
                  role, granted_by, created_at`,
       [
         fileId,
         recipient.id,
         normalizedRole,
         req.userId
       ]
     );

     const share = shareResult.rows[0];

     // Append an immutable activity event in the same transaction.
     await client.query(
       `INSERT INTO activity_logs
          (actor_user_id, action, file_id, metadata)
        VALUES ($1, 'FILE_SHARED', $2, $3::jsonb)`,
       [
         req.userId,
         fileId,
         JSON.stringify({
           recipientUserId: recipient.id,
           recipientEmail: recipient.email,
           role: normalizedRole,
           shareId: share.id
         })
       ]
     );

     await client.query("COMMIT");

     return res.status(201).json({
       message: "File shared successfully.",
       share: {
         ...share,
         recipient_name: recipient.full_name,
         recipient_email: recipient.email
       }
     });

   } catch (error) {
     if (client) {
       await client.query("ROLLBACK").catch(() => {});
     }

     if (
       error.code === "23505" &&
       error.constraint === "unique_active_file_share"
     ) {
       return next(fail(409, "This user already has access to the file."));
     }

     return next(error);

   } finally {
     client?.release();
   }
 });


 // DELETE /api/files/:id/shares/:shareId
 // Revoke an existing share immediately.

 router.delete(
   "/:id/shares/:shareId",
   requireAuth,
   async (req, res, next) => {
     let client;

     try {
       const fileId = req.params.id;
       const shareId = req.params.shareId;

       if (!UUID_RE.test(fileId) || !UUID_RE.test(shareId)) {
         throw fail(400, "Invalid file or share ID.");
       }

       client = await pool.connect();

       await client.query("BEGIN");

       // Serialize share revocation with other management operations.
       const fileResult = await client.query(
         `SELECT id, owner_id
          FROM files
          WHERE id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
         [fileId]
       );

       if (fileResult.rowCount !== 1) {
         throw fail(404, "File not found.");
       }

       if (fileResult.rows[0].owner_id !== req.userId) {
         throw fail(403, "Only the file owner can revoke sharing.");
       }

       // Soft-revoke rather than deleting the historical share record.
       const revokeResult = await client.query(
         `UPDATE file_shares
          SET revoked_at = NOW()
          WHERE id = $1
            AND file_id = $2
            AND revoked_at IS NULL
          RETURNING id, shared_with_user_id, role, revoked_at`,
         [shareId, fileId]
       );

       if (revokeResult.rowCount !== 1) {
         throw fail(404, "Active share not found.");
       }

       const revokedShare = revokeResult.rows[0];

       // Record the revocation as an append-only event.
       await client.query(
         `INSERT INTO activity_logs
            (actor_user_id, action, file_id, metadata)
          VALUES ($1, 'SHARE_REVOKED', $2, $3::jsonb)`,
         [
           req.userId,
           fileId,
           JSON.stringify({
             shareId: revokedShare.id,
             revokedUserId: revokedShare.shared_with_user_id,
             previousRole: revokedShare.role
           })
         ]
       );

       await client.query("COMMIT");

       return res.status(200).json({
         message: "File sharing revoked successfully.",
         share: revokedShare
       });

     } catch (error) {
       if (client) {
         await client.query("ROLLBACK").catch(() => {});
       }

       return next(error);

     } finally {
       client?.release();
     }
   }
 );

// ==========================================
// 5. DOWNLOAD A SPECIFIC VERSION
// GET /api/files/:id/versions/:versionNo/download
// ==========================================

router.get(
  "/:id/versions/:versionNo/download",
  requireAuth,
  async (req, res, next) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        throw fail(400, "Invalid file ID.");
      }

      const versionNo = Number(req.params.versionNo);

      if (!Number.isInteger(versionNo) || versionNo < 1) {
        throw fail(400, "Invalid version number.");
      }

      const access = await fileAccess(
        req.params.id,
        req.userId
      );

      if (!access) {
        throw fail(404, "File not found or you do not have access.");
      }

      const result = await pool.query(
        `SELECT blob_key
         FROM file_versions
         WHERE file_id = $1 AND version_no = $2`,
        [req.params.id, versionNo]
      );

      if (result.rowCount !== 1) {
        throw fail(404, "Version not found.");
      }

      const diskPath = blobPathFor(result.rows[0].blob_key);

      await fs.access(diskPath);

      return res.download(
        diskPath,
        access.display_name,
        (error) => {
          if (error && !res.headersSent) {
            next(error);
          }
        }
      );

    } catch (error) {
      return next(error);
    }
  }
);


// ==========================================
// FILE RENAME
// PATCH /api/files/:id
// ==========================================

router.patch("/:id", requireAuth, async (req, res, next) => {
  let client;
  let inTransaction = false;

  try {
    const fileId = req.params.id;
    const { displayName: newName } = req.body ?? {};

    if (!UUID_RE.test(fileId)) {
      throw fail(400, "Invalid file ID.");
    }

    if (typeof newName !== "string") {
      throw fail(400, "New file name is required.");
    }

    const name = newName.trim();

    if (
      !name ||
      name.length > 255 ||
      /[\\/\u0000-\u001f\u007f]/.test(name)
    ) {
      throw fail(400, "Invalid file name.");
    }

    client = await pool.connect();
    await client.query("BEGIN");
    inTransaction = true;

    const existing = await client.query(
      `SELECT id, owner_id, display_name
       FROM files
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [fileId]
    );

    if (existing.rowCount !== 1) {
      throw fail(404, "File not found.");
    }

    if (existing.rows[0].owner_id !== req.userId) {
      throw fail(403, "Only the file owner can rename this file.");
    }

    const oldName = existing.rows[0].display_name;

    const result = await client.query(
      `UPDATE files
       SET display_name = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, display_name, updated_at`,
      [name, fileId]
    );

    await client.query(
      `INSERT INTO activity_logs
         (actor_user_id, action, file_id, metadata)
       VALUES ($1, 'FILE_RENAMED', $2, $3::jsonb)`,
      [
        req.userId,
        fileId,
        JSON.stringify({
          oldName,
          newName: name
        })
      ]
    );

    await client.query("COMMIT");
    inTransaction = false;

    return res.status(200).json({
      message: "File renamed successfully.",
      file: result.rows[0]
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
// SOFT DELETE FILE
// DELETE /api/files/:id
// ==========================================

router.delete("/:id", requireAuth, async (req, res, next) => {
  let client;
  let inTransaction = false;

  try {
    const fileId = req.params.id;

    if (!UUID_RE.test(fileId)) {
      throw fail(400, "Invalid file ID.");
    }

    client = await pool.connect();

    await client.query("BEGIN");
    inTransaction = true;

    const existing = await client.query(
      `SELECT id, owner_id, display_name
       FROM files
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [fileId]
    );

    if (existing.rowCount !== 1) {
      throw fail(404, "File not found.");
    }

    if (existing.rows[0].owner_id !== req.userId) {
      throw fail(403, "Only the file owner can delete this file.");
    }

    const fileName = existing.rows[0].display_name;

    // Mark deleted; do not physically remove historical versions.
    await client.query(
      `UPDATE files
       SET deleted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [fileId]
    );

    // Revoke all active shares.
    await client.query(
      `UPDATE file_shares
       SET revoked_at = NOW()
       WHERE file_id = $1
         AND revoked_at IS NULL`,
      [fileId]
    );

    await client.query(
      `INSERT INTO activity_logs
         (actor_user_id, action, file_id, metadata)
       VALUES ($1, 'FILE_DELETED', $2, $3::jsonb)`,
      [
        req.userId,
        fileId,
        JSON.stringify({
          fileName,
          deletionType: "soft_delete"
        })
      ]
    );

    await client.query("COMMIT");
    inTransaction = false;

    return res.status(200).json({
      message: "File moved to deleted state successfully.",
      fileId
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
// PUBLIC SHARE LINKS
// POST /api/files/:id/share-links
// Create a public link (owner only).
// ==========================================

router.post("/:id/share-links", requireAuth, async (req, res, next) => {
  let client;

  try {
    const fileId = req.params.id;
    const permission = (
      typeof req.body?.permission === "string"
        ? req.body.permission.trim().toLowerCase()
        : "viewer"
    );

    const expiresAtInput = req.body?.expiresAt;
    let expiresAt = null;

    if (!UUID_RE.test(fileId)) {
      throw fail(400, "Invalid file ID.");
    }

    if (!["viewer", "editor"].includes(permission)) {
      throw fail(400, "Permission must be viewer or editor.");
    }

    // Validate optional expiry date.
    if (
      expiresAtInput !== undefined &&
      expiresAtInput !== null &&
      expiresAtInput !== ""
    ) {
      if (typeof expiresAtInput !== "string") {
        throw fail(400, "Expiry must be a valid date string.");
      }

      const parsedDate = new Date(expiresAtInput);

      if (
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.getTime() <= Date.now()
      ) {
        throw fail(400, "Expiry date must be a valid future date.");
      }

      expiresAt = parsedDate.toISOString();
    }

    client = await pool.connect();
    await client.query("BEGIN");

    // Lock the file row and verify ownership.
    const fileResult = await client.query(
      `SELECT id, owner_id, display_name
       FROM files
       WHERE id = $1
         AND deleted_at IS NULL
       FOR UPDATE`,
      [fileId]
    );

    if (fileResult.rowCount !== 1) {
      throw fail(404, "File not found.");
    }

    if (fileResult.rows[0].owner_id !== req.userId) {
      throw fail(403, "Only the file owner can create public links.");
    }

    // Generate a secure token. Store only its SHA-256 hash.
    const rawToken = randomBytes(32).toString("base64url");

    const tokenHash = createHash("sha256")
      .update(rawToken)
      .digest("hex");

    const insertResult = await client.query(
      `INSERT INTO share_links
         (file_id, token_hash, permission, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, permission, expires_at, created_at`,
      [fileId, tokenHash, permission, req.userId, expiresAt]
    );

    const shareLink = insertResult.rows[0];

    // Record the event without storing the secret token.
    await client.query(
      `INSERT INTO activity_logs
         (actor_user_id, action, file_id, metadata)
       VALUES ($1, 'SHARE_LINK_CREATED', $2, $3::jsonb)`,
      [
        req.userId,
        fileId,
        JSON.stringify({
          shareLinkId: shareLink.id,
          permission: shareLink.permission,
          expiresAt: shareLink.expires_at
        })
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Public share link created successfully.",
      shareLink: {
        id: shareLink.id,
        permission: shareLink.permission,
        expiresAt: shareLink.expires_at,
        createdAt: shareLink.created_at,
        url: `/api/files/public/${rawToken}`
      }
    });

  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    return next(error);

  } finally {
    client?.release();
  }
});

// ==========================================
// GET /api/files/:id/share-links
// List public links (owner only).
// ==========================================

router.get("/:id/share-links", requireAuth, async (req, res, next) => {
  try {
    const fileId = req.params.id;

    if (!UUID_RE.test(fileId)) {
      throw fail(400, "Invalid file ID.");
    }

    const fileResult = await pool.query(
      `SELECT owner_id
       FROM files
       WHERE id = $1
         AND deleted_at IS NULL`,
      [fileId]
    );

    if (fileResult.rowCount !== 1) {
      throw fail(404, "File not found.");
    }

    if (fileResult.rows[0].owner_id !== req.userId) {
      throw fail(403, "Only the file owner can view public links.");
    }

    const result = await pool.query(
      `SELECT
         id,
         permission,
         expires_at,
         revoked_at,
         created_at,
         CASE
           WHEN revoked_at IS NOT NULL THEN 'revoked'
           WHEN expires_at IS NOT NULL AND expires_at <= NOW()
             THEN 'expired'
           ELSE 'active'
         END AS status
       FROM share_links
       WHERE file_id = $1
       ORDER BY created_at DESC`,
      [fileId]
    );

    return res.status(200).json({
      fileId,
      shareLinks: result.rows
    });

  } catch (error) {
    return next(error);
  }
});


// ==========================================
// DELETE /api/files/:id/share-links/:linkId
// Revoke a public link (owner only).
// ==========================================

router.delete(
  "/:id/share-links/:linkId",
  requireAuth,
  async (req, res, next) => {
    let client;

    try {
      const fileId = req.params.id;
      const linkId = req.params.linkId;

      if (!UUID_RE.test(fileId) || !UUID_RE.test(linkId)) {
        throw fail(400, "Invalid file or share link ID.");
      }

      client = await pool.connect();
      await client.query("BEGIN");

      // Lock the file and verify ownership.
      const fileResult = await client.query(
        `SELECT owner_id
         FROM files
         WHERE id = $1
           AND deleted_at IS NULL
         FOR UPDATE`,
        [fileId]
      );

      if (fileResult.rowCount !== 1) {
        throw fail(404, "File not found.");
      }

      if (fileResult.rows[0].owner_id !== req.userId) {
        throw fail(403, "Only the file owner can revoke public links.");
      }

      // Revoke the link without deleting its history.
      const revokeResult = await client.query(
        `UPDATE share_links
         SET revoked_at = NOW()
         WHERE id = $1
           AND file_id = $2
           AND revoked_at IS NULL
         RETURNING id, permission, expires_at, revoked_at`,
        [linkId, fileId]
      );

      if (revokeResult.rowCount !== 1) {
        throw fail(404, "Active public share link not found.");
      }

      const revokedLink = revokeResult.rows[0];

      // Record the revocation.
      await client.query(
        `INSERT INTO activity_logs
           (actor_user_id, action, file_id, metadata)
         VALUES ($1, 'SHARE_LINK_REVOKED', $2, $3::jsonb)`,
        [
          req.userId,
          fileId,
          JSON.stringify({
            shareLinkId: revokedLink.id,
            permission: revokedLink.permission
          })
        ]
      );

      await client.query("COMMIT");

      return res.status(200).json({
        message: "Public share link revoked successfully.",
        shareLink: revokedLink
      });

    } catch (error) {
      if (client) {
        await client.query("ROLLBACK").catch(() => {});
      }

      return next(error);

    } finally {
      client?.release();
    }
  }
);

// ======================================================
// PUBLIC SHARE LINK: ANONYMOUS EDITOR UPLOAD
// POST /api/files/public/:token/versions
// No login required; active editor link required
// ======================================================

router.post(
  "/public/:token/versions",
  receiveFile,
  async (req, res, next) => {
    let reserved = false;
    let savedBlobPath = null;
    let requestId = null;
    let ownerId = null;
    let bytes = 0;

    try {
      if (!req.file) {
        throw fail(
          400,
          "Upload one file using the multipart field named 'file'."
        );
      }

      const token = req.params.token;
      const tokenHash = hashShareToken(token);

      // Verify that the public link is currently active.
      const link = await getActiveShareLink(token);

      if (!link) {
        throw fail(404, "Share link is invalid, expired, or revoked.");
      }

      if (link.permission !== "editor") {
        throw fail(403, "This public share link does not allow uploads.");
      }

      const fileId = link.file_id;
      ownerId = link.owner_id;
      bytes = req.file.size;

      const checksum = await sha256(req.file.path);
      const name = displayName(req);

      // Anonymous uploads are accounted against the file owner's quota.
      // The owner ID is also used for the required uploader database reference.

      const rawKey = getIdempotencyKey(req);
      const key = `public:${link.link_id}:${rawKey}`;

      if (key.length > 255) {
        throw fail(400, "Idempotency key is too long.");
      }

      const fingerprint = uploadFingerprint({
        operation: "public-new-version",
        fileId,
        linkId: link.link_id,
        displayName: name,
        sizeBytes: bytes,
        checksum
      });

      // Claim this logical upload.
      const claim = await claimUploadRequest(
        ownerId,
        key,
        fingerprint
      );

      requestId = claim.requestId;

      // Return the original result for an already completed retry.
      if (claim.completed) {
        return res.status(200).json({
          message: "This upload was already completed.",
          ...claim.completed
        });
      }

      // Reserve the owner's storage quota.
      await reserveQuota(ownerId, bytes);
      reserved = true;

      // Store the upload as an immutable private blob.
      const blobKey = randomUUID();

      savedBlobPath = blobPathFor(blobKey);
      await fs.rename(req.file.path, savedBlobPath);

      let createdVersion = null;

      // Retry version conflicts a bounded number of times.
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        const client = await pool.connect();

        try {
          await client.query("BEGIN");

          // Lock the share link and file while checking permission.
          // This prevents revocation or deletion racing with the upload.
          const accessResult = await client.query(
            `SELECT
               sl.id AS link_id,
               sl.file_id,
               sl.permission,
               sl.expires_at,
               sl.revoked_at,
               f.owner_id,
               f.deleted_at
             FROM share_links sl
             JOIN files f ON f.id = sl.file_id
             WHERE sl.id = $1
               AND sl.file_id = $2
               AND sl.token_hash = $3
             FOR SHARE OF sl, f`,
            [link.link_id, fileId, tokenHash]
          );

          const currentLink = accessResult.rows[0];

          if (!currentLink) {
            throw fail(404, "Public share link is no longer available.");
          }

          if (
            currentLink.revoked_at ||
            (
              currentLink.expires_at &&
              new Date(currentLink.expires_at) <= new Date()
            ) ||
            currentLink.deleted_at
          ) {
            throw fail(404, "Public share link is invalid, expired, or revoked.");
          }

          if (currentLink.permission !== "editor") {
            throw fail(403, "This public share link does not allow uploads.");
          }

          if (currentLink.owner_id !== ownerId) {
            throw fail(403, "Share link ownership changed.");
          }

          // Allocate the next immutable version number.
          const result = await client.query(
            `INSERT INTO file_versions
               (file_id, version_no, uploader_id, blob_key,
                size_bytes, checksum_sha256, content_type)
             SELECT
               $1,
               COALESCE(MAX(version_no), 0) + 1,
               $2, $3, $4, $5, $6
             FROM file_versions
             WHERE file_id = $1
             RETURNING id, file_id, version_no, size_bytes,
                       checksum_sha256, uploaded_at`,
            [
              fileId,
              ownerId,
              blobKey,
              bytes,
              checksum,
              req.file.mimetype || "application/octet-stream"
            ]
          );

          const version = result.rows[0];

          // Finalize quota in the same transaction.
          await finalizeQuota(client, ownerId, bytes);

          // Record that this version came through an anonymous editor link.
          await activity(
            client,
            ownerId,
            fileId,
            version.id,
            version.version_no,
            "VERSION_CREATED",
            {
              anonymousPublicUpload: true,
              publicLinkId: link.link_id
            }
          );

          // Complete the idempotency request atomically.
          await completeUploadRequest(
            client,
            requestId,
            fileId,
            version.id
          );

          await client.query("COMMIT");

          createdVersion = version;
          break;

        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});

          if (
            error.code === "23505" &&
            error.constraint === "unique_file_version" &&
            attempt < MAX_RETRIES
          ) {
            const delay =
              Math.min(200, attempt * 10) +
              Math.floor(Math.random() * 30);

            await sleep(delay);
            continue;
          }

          if (
            error.code === "23505" &&
            error.constraint === "unique_file_version"
          ) {
            break;
          }

          throw error;

        } finally {
          client.release();
        }
      }

      if (!createdVersion) {
        throw fail(
          409,
          "Version allocation conflicted repeatedly. Retry this upload."
        );
      }

      reserved = false;
      savedBlobPath = null;

      return res.status(201).json({
        message: "New version uploaded successfully through public editor link.",
        fileId,
        version: createdVersion
      });

    } catch (error) {
      if (savedBlobPath) {
        await cleanup(savedBlobPath);
      }

      if (reserved && ownerId) {
        await releaseQuota(ownerId, bytes).catch(() => {});
      }

      if (requestId) {
        await markUploadRequestFailed(requestId).catch(() => {});
      }

      return next(error);

    } finally {
      await cleanup(req.file?.path);
    }
  }
);

// ======================================================
// PUBLIC SHARE LINK: VIEW FILE AND VERSION HISTORY
// No login required
// ======================================================

router.get("/public/:token", async (req, res, next) => {
  try {
    const link = await getActiveShareLink(req.params.token);

    if (!link) {
      throw fail(404, "Share link is invalid, expired, or revoked.");
    }

    const versions = await pool.query(
      `SELECT
         fv.version_no,
         fv.size_bytes,
         fv.checksum_sha256,
         fv.content_type,
         fv.uploaded_at,
         u.full_name AS uploader_name
       FROM file_versions fv
       LEFT JOIN users u ON u.id = fv.uploader_id
       WHERE fv.file_id = $1
       ORDER BY fv.version_no DESC`,
      [link.file_id]
    );

    return res.json({
      success: true,
      file: {
        id: link.file_id,
        name: link.display_name,
        permission: link.permission,
        expiresAt: link.expires_at
      },
      versions: versions.rows
    });
  } catch (error) {
    next(error);
  }
});


// ======================================================
// PUBLIC SHARE LINK: DOWNLOAD LATEST VERSION
// ======================================================

router.get("/public/:token/download", async (req, res, next) => {
  try {
    const link = await getActiveShareLink(req.params.token);

    if (!link) {
      throw fail(404, "Share link is invalid, expired, or revoked.");
    }

    const result = await pool.query(
      `SELECT blob_key
       FROM file_versions
       WHERE file_id = $1
       ORDER BY version_no DESC
       LIMIT 1`,
      [link.file_id]
    );

    if (result.rowCount === 0) {
      throw fail(404, "No file version exists.");
    }

    const diskPath = blobPathFor(result.rows[0].blob_key);

    await fs.access(diskPath);

    return res.download(diskPath, link.display_name);
  } catch (error) {
    next(error);
  }
});


// ======================================================
// PUBLIC SHARE LINK: DOWNLOAD A SPECIFIC VERSION
// ======================================================

router.get(
  "/public/:token/versions/:versionNo/download",
  async (req, res, next) => {
    try {
      const link = await getActiveShareLink(req.params.token);

      if (!link) {
        throw fail(404, "Share link is invalid, expired, or revoked.");
      }

      const versionNo = Number(req.params.versionNo);

      if (!Number.isInteger(versionNo) || versionNo < 1) {
        throw fail(400, "Invalid version number.");
      }

      const result = await pool.query(
        `SELECT blob_key
         FROM file_versions
         WHERE file_id = $1 AND version_no = $2
         LIMIT 1`,
        [link.file_id, versionNo]
      );

      if (result.rowCount === 0) {
        throw fail(404, "File version not found.");
      }

      const diskPath = blobPathFor(result.rows[0].blob_key);

      await fs.access(diskPath);

      return res.download(
        diskPath,
        `${link.display_name}.v${versionNo}`
      );
    } catch (error) {
      next(error);
    }
  }
);

export default router;
