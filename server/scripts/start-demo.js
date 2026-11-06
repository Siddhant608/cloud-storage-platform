import "dotenv/config";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing.");
}

const demoUrl = new URL(process.env.DATABASE_URL);
demoUrl.pathname = "/cloud_storage_demo_db";

process.env.DATABASE_URL = demoUrl.toString();

console.log("Starting CloudVault with cloud_storage_demo_db...");

await import("../src/server.js");
