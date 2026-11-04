import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";

const router = Router();

// Helper: regenerate session ID after login
function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

// Helper: save session to PostgreSQL
function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

// ========================================
// 1. REGISTER
// POST /api/auth/register
// ========================================

router.post("/register", async (req, res, next) => {
  const { fullName, email, password } = req.body ?? {};

  if (
    typeof fullName !== "string" ||
    typeof email !== "string" ||
    typeof password !== "string"
  ) {
    return res.status(400).json({
      error: "Full name, email and password are required."
    });
  }

  const cleanName = fullName.trim();
  const cleanEmail = email.trim();
  const normalizedEmail = cleanEmail.toLowerCase();

  if (cleanName.length < 2 || cleanName.length > 100) {
    return res.status(400).json({
      error: "Full name must contain between 2 and 100 characters."
    });
  }

  if (
    cleanEmail.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
  ) {
    return res.status(400).json({
      error: "Please enter a valid email address."
    });
  }

  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({
      error: "Password must be at least 8 characters and at most 72 bytes."
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const client = await pool.connect();

    let user;

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `INSERT INTO users
          (full_name, email, email_normalized, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, full_name, email, created_at`,
        [cleanName, cleanEmail, normalizedEmail, passwordHash]
      );

      user = result.rows[0];

      // Give every new user a default 500 MB quota.
      await client.query(
        "INSERT INTO storage_usage (user_id) VALUES ($1)",
        [user.id]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});

      if (error.code === "23505") {
        return res.status(409).json({
          error: "An account with this email already exists."
        });
      }

      return next(error);
    } finally {
      client.release();
    }

    // Automatically log in after registration.
    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);

    return res.status(201).json({
      message: "Registration successful.",
      user
    });
  } catch (error) {
    return next(error);
  }
});

// ========================================
// 2. LOGIN
// POST /api/auth/login
// ========================================

router.post("/login", async (req, res, next) => {
  const { email, password } = req.body ?? {};

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password
  ) {
    return res.status(400).json({
      error: "Email and password are required."
    });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const result = await pool.query(
      `SELECT id, full_name, email, password_hash
       FROM users
       WHERE email_normalized = $1`,
      [normalizedEmail]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    // Regenerate session ID to reduce session-fixation risk.
    await regenerateSession(req);

    req.session.userId = user.id;
    await saveSession(req);

    return res.status(200).json({
      message: "Login successful.",
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email
      }
    });
  } catch (error) {
    return next(error);
  }
});

// ========================================
// 3. CURRENT USER
// GET /api/auth/me
// ========================================

router.get("/me", async (req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({
      error: "Please log in first."
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, full_name, email, created_at
       FROM users
       WHERE id = $1`,
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "User account not found."
      });
    }

    return res.status(200).json({
      user: result.rows[0]
    });
  } catch (error) {
    return next(error);
  }
});

// ========================================
// 4. LOGOUT
// POST /api/auth/logout
// ========================================

router.post("/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);

    res.clearCookie("cloudvault.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/"
    });

    return res.status(200).json({
      message: "Logout successful."
    });
  });
});

export default router;