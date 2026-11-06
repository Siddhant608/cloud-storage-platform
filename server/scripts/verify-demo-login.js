import "dotenv/config";
import pg from "pg";
import bcrypt from "bcryptjs";

const url = new URL(process.env.DATABASE_URL);
url.pathname = "/cloud_storage_demo_db";

const pool = new pg.Pool({ connectionString: url.toString() });

try {
  const result = await pool.query(
    "SELECT password_hash FROM users WHERE email_normalized = $1",
    ["demo.owner@cloudvault.demo"]
  );

  if (!result.rows.length) {
    console.log("User found: false");
  } else {
    const hash = result.rows[0].password_hash;

    console.log("User found: true");
    console.log("Bcrypt hash prefix:", hash.slice(0, 7));
    console.log(
      "Password matches:",
      await bcrypt.compare("CloudVaultDemo!2026", hash)
    );
  }
} finally {
  await pool.end();
}
