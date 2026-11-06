
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import path from "node:path";
import { fileURLToPath } from "node:url";

import { env } from "./config/env.js";
import { pool } from "./db/pool.js";

import healthRouter from "./routes/health.routes.js";
import authRouter from "./routes/auth.routes.js";
import filesRouter from "./routes/files.routes.js";
import foldersRouter from "./routes/folders.routes.js";
import activityRouter from "./routes/activity.routes.js";

import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

const clientDirectory = path.resolve(
  currentDirectory,
  "../../client"
);

// PostgreSQL session storage
const PgStore = connectPgSimple(session);

const sessionStore = new PgStore({
  pool,
  tableName: "user_sessions",
  createTableIfMissing: true
});

app.disable("x-powered-by");

app.use(helmet());
app.use(
  pinoHttp({
    redact: {
      paths: [
        "req.headers.cookie",
        "req.headers.authorization",
        'res.headers["set-cookie"]'
      ],
      censor: "[REDACTED]"
    },

    serializers: {
      req(req) {
        return {
          method: req.method,
          remoteAddress: req.remoteAddress,
          remotePort: req.remotePort
        };
      }
    }
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// Configure user sessions
app.use(
  session({
    name: "cloudvault.sid",
    store: sessionStore,
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: env.nodeEnv === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

// Serve frontend
app.use(express.static(clientDirectory));

// API routes
app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/files", filesRouter);
app.use("/api/folders", foldersRouter);
app.use("/api/activity", activityRouter);

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({
    error: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

// Error handler
app.use(errorHandler);

export default app;
