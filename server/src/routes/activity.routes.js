
import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

// ==========================================
// GET USER ACTIVITY HISTORY
// GET /api/activity
// ==========================================

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      return res.status(400).json({
        error: "Limit must be between 1 and 100."
      });
    }

    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 1000000
    ) {
      return res.status(400).json({
        error: "Invalid offset."
      });
    }

    const result = await pool.query(
      `SELECT
         a.id,
         a.actor_user_id,
         a.action,
         a.file_id,
         a.version_id,
         a.request_id,
         a.metadata,
         a.occurred_at,
         f.display_name,
         v.version_no,
         actor.full_name AS actor_name
       FROM activity_logs a
       LEFT JOIN files f ON f.id = a.file_id
       LEFT JOIN file_versions v ON v.id = a.version_id
       LEFT JOIN users actor ON actor.id = a.actor_user_id
       WHERE
         a.actor_user_id = $1
         OR EXISTS (
           SELECT 1
           FROM files owned
           WHERE owned.id = a.file_id
             AND owned.owner_id = $1
         )
       ORDER BY a.occurred_at DESC, a.id DESC
       LIMIT $2 OFFSET $3`,
      [req.userId, limit + 1, offset]
    );

    const hasMore = result.rows.length > limit;
    const activities = result.rows.slice(0, limit);

    return res.status(200).json({
      activities,
      pagination: {
        limit,
        offset,
        hasMore
      }
    });

  } catch (error) {
    return next(error);
  }
});

export default router;
