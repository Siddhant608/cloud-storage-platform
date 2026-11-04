import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

// PostgreSQL is the source of truth for metadata, permissions, and version numbers.
export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Enable TLS for production database connections. Configure certificates
  // according to the hosting provider when deploying.
  ...(env.nodeEnv === "production" ? { ssl: { rejectUnauthorized: true } } : {})
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});
