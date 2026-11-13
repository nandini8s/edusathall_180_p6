const mongoose = require("mongoose");
const { CATEGORIES } = require("../config/anomalyConfig");

const handlerSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, immutable: true, trim: true },
  role: { type: String, required: true, enum: ["primary", "backup"], default: "primary" },
  primaryHandlerKey: { type: String, required: true, trim: true },
  corridor: { type: String, required: true, trim: true },
  destination: { type: String, required: true, trim: true },
  eligibleCategories: [{ type: String, enum: CATEGORIES }],
  available: { type: Boolean, required: true, default: true },
  maxCapacity: { type: Number, required: true, min: 0 },
  activeReportIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Anomaly" }],
}, { timestamps: true });

module.exports = mongoose.models.Handler || mongoose.model("Handler", handlerSchema);
