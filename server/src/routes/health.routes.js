import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT NOW() AS database_time");
    return res.status(200).json({
      status: "ok",
      message: "API and database are running.",
      database: "connected",
      databaseTime: result.rows[0].database_time
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
