
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// services -> src -> server
const serverDir = path.resolve(currentDir, "../..");
const blobDir = path.join(serverDir, "storage", "blobs");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function processPurgeJob(db, jobId) {
  const result = await db.query(
    `SELECT id, blob_keys
     FROM file_purge_jobs
     WHERE id = $1 AND status = 'pending'`,
    [jobId]
  );

  if (result.rows.length === 0) {
    return false;
  }

  const blobKeys = result.rows[0].blob_keys;

  if (!Array.isArray(blobKeys)) {
    throw new Error(`Invalid blob list in purge job ${jobId}`);
  }

  // Remove each blob. Missing files are already cleaned up.
  // If any other deletion fails, the job remains pending.
  for (const blobKey of blobKeys) {
    if (typeof blobKey !== "string" || !UUID_RE.test(blobKey)) {
      throw new Error(`Invalid blob key in purge job ${jobId}`);
    }

    await fs.rm(path.join(blobDir, blobKey), { force: true });
  }

  // Mark complete only after every blob has been removed.
  await db.query(
    `UPDATE file_purge_jobs
     SET status = 'completed',
         completed_at = NOW()
     WHERE id = $1 AND status = 'pending'`,
    [jobId]
  );

  return true;
}

export async function processPendingPurgeJobs(db) {
  const result = await db.query(
    `SELECT id
     FROM file_purge_jobs
     WHERE status = 'pending'
     ORDER BY created_at ASC`
  );

  for (const job of result.rows) {
    try {
      await processPurgeJob(db, job.id);
      console.log(`Purge recovery completed: ${job.id}`);
    } catch (error) {
      // Keep the job pending so a later recovery can retry it.
      console.error(
        `Purge recovery failed for ${job.id}:`,
        error.message
      );
    }
  }
}
