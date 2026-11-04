import app from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";

let httpServer;

async function startServer() {
  // Fail fast if PostgreSQL is unavailable; the project requires the database.
  await pool.query("SELECT 1");

  httpServer = app.listen(env.port, () => {
    console.log(`Cloud Storage API is running at http://localhost:${env.port}`);
  });
}

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);

  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }

  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

startServer().catch(async (error) => {
  console.error("Failed to start the server:", error.message);
  await pool.end();
  process.exit(1);
});
