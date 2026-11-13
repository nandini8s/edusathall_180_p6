const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const anomalyRoutes = require("./routes/anomalyRoutes");
const handlerRoutes = require("./routes/handlerRoutes");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");

function createApp() {
  const app = express();
  const defaultOrigins = "http://localhost:5173,http://localhost:5174";
  const origins = (process.env.CORS_ORIGINS || defaultOrigins).split(",").map((origin) => origin.trim()).filter(Boolean);
  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: "32kb" }));
  app.get("/", (req, res) => res.json({ success: true, message: "Metro Anomaly Reporter API is running!" }));
  app.get("/api/health", (req, res) => {
    const state = ["disconnected", "connected", "connecting", "disconnecting"][mongoose.connection.readyState] || "unknown";
    const healthy = state === "connected";
    res.status(healthy ? 200 : 503).json({ success: healthy, data: { backend: "healthy", database: state } });
  });
  app.use("/api/anomalies", anomalyRoutes);
  app.use("/api/handlers", handlerRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
