
import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

// GET /api/storage/usage
router.get("/usage", async (req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({
      error: "Please log in first."
    });
  }

  try {
    const result = await pool.query(
      `SELECT quota_bytes, used_bytes, reserved_bytes
       FROM storage_usage
       WHERE user_id = $1`,
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Storage information not found."
      });
    }

    const usage = result.rows[0];

    return res.status(200).json({
      usage: {
        quotaBytes: Number(usage.quota_bytes),
        usedBytes: Number(usage.used_bytes),
        reservedBytes: Number(usage.reserved_bytes),
        availableBytes:
          Number(usage.quota_bytes) -
          Number(usage.used_bytes) -
          Number(usage.reserved_bytes)
      }
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
