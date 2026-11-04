export function errorHandler(error, req, res, next) {
  req.log?.error({ err: error }, "Request failed");

  if (res.headersSent) {
    return next(error);
  }

  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  const message = statusCode >= 500 && process.env.NODE_ENV === "production"
    ? "Internal server error."
    : error.message || "Internal server error.";

  return res.status(statusCode).json({ error: message });
}
