"use strict";

const express = require("express");
const os = require("os");

// ── App Setup ────────────────────────────────
const app = express();
const START_TIME = Date.now();
const PORT = process.env.PORT || 8080; // GCP Cloud Run uses 8080
const NODE_ENV = process.env.NODE_ENV || "development";

// ── Middleware ───────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic security headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

// Request logger (JSON format so GCP Cloud Logging can parse it)
app.use((req, _res, next) => {
  console.log(JSON.stringify({
    method: req.method,
    url: req.url,
    ip: req.ip,
    time: new Date().toISOString(),
  }));
  next();
});

// ── Routes ───────────────────────────────────

// Root
app.get("/", (_req, res) => {
  res.json({ message: "Server is running 🚀", env: NODE_ENV });
});

// Liveness probe — GCP Cloud Run pings this to check the process is alive
app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Detailed status — handy when debugging a fresh deployment
app.get("/status", (_req, res) => {
  const uptimeSec = Math.floor((Date.now() - START_TIME) / 1000);

  res.json({
    status: "running",
    env: NODE_ENV,
    uptime: `${uptimeSec}s`,
    node: process.version,
    memory: {
      heapUsed: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + " MB",
      rss: (process.memoryUsage().rss / 1024 / 1024).toFixed(2) + " MB",
    },
    host: os.hostname(),
    timestamp: new Date().toISOString(),
  });
});

// ── Error Handling ───────────────────────────

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.url} not found` });
});

// 500
app.use((err, req, res, _next) => {
  console.error(JSON.stringify({ severity: "ERROR", message: err.message, url: req.url }));
  res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
});

// ── Start Server ─────────────────────────────
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ message: `Server started on port ${PORT}`, env: NODE_ENV }));
});

// ── Graceful Shutdown (required for GCP Cloud Run) ───────────────────────────
// Cloud Run sends SIGTERM before stopping a container.
// We wait for in-flight requests to finish, then exit cleanly.
function shutdown(signal) {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(() => process.exit(0));

  // Force exit if it takes too long
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({ severity: "CRITICAL", message: "Unhandled rejection", reason: String(reason) }));
});

process.on("uncaughtException", (err) => {
  console.error(JSON.stringify({ severity: "CRITICAL", message: "Uncaught exception", error: err.message }));
  process.exit(1);
});

module.exports = app;