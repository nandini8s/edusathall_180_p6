const mongoose = require("mongoose");
const { CATEGORIES } = require("../config/anomalyConfig");

const assignmentAttemptSchema = new mongoose.Schema({
  handlerKey: { type: String, required: true },
  handlerId: { type: mongoose.Schema.Types.ObjectId, ref: "Handler" },
  role: { type: String, required: true, enum: ["primary", "backup"] },
  attemptedAt: { type: Date, required: true, default: Date.now },
  outcome: { type: String, required: true, enum: ["assigned", "unavailable", "at_capacity", "not_configured", "ineligible", "already_reserved"] },
  failureReason: { type: String, trim: true },
}, { _id: false });

const anomalySchema = new mongoose.Schema({
  stationCode: { type: String, required: true, uppercase: true, trim: true, match: /^STA[A-Z]{2}[0-9]{3}$/ },
  anomalyCode: { type: String, required: true, uppercase: true, trim: true, match: /^A[0-9]{2}$/ },
  category: { type: String, required: true, enum: CATEGORIES, index: true },
  priority: { type: String, required: true, enum: ["Critical", "High", "Medium", "Low"], index: true },
  description: { type: String, required: true, trim: true, minlength: 5, maxlength: 2000 },
  corridor: { type: String, required: true, trim: true },
  destination: { type: String, required: true, trim: true },
  primaryHandlerKey: { type: String, trim: true },
  handlerKey: { type: String, trim: true },
  handlerId: { type: mongoose.Schema.Types.ObjectId, ref: "Handler" },
  assignmentRole: { type: String, enum: ["primary", "backup"] },
  assignmentHistory: { type: [assignmentAttemptSchema], default: [] },
  escalated: { type: Boolean, required: true, default: false, index: true },
  escalationReason: { type: String, trim: true },
  escalatedAt: { type: Date },
  retryAttempts: { type: Number, required: true, default: 0, min: 0 },
  lastRetryAt: { type: Date },
  lastRetryOutcome: { type: String, enum: ["assigned_primary", "assigned_backup", "no_handler"] },
  status: { type: String, required: true, enum: ["Pending", "Assigned", "In Progress", "Resolved"], default: "Pending", index: true },
  isValid: { type: Boolean, required: true, default: true },
  validationResult: {
    stationCode: { regexValid: { type: Boolean, required: true }, dfaValid: { type: Boolean, required: true } },
    anomalyCode: { regexValid: { type: Boolean, required: true }, dfaValid: { type: Boolean, required: true } },
  },
}, { timestamps: true });

anomalySchema.index({ createdAt: -1 });
anomalySchema.index({ escalated: 1, status: 1, escalatedAt: 1 });

module.exports = mongoose.models.Anomaly || mongoose.model("Anomaly", anomalySchema);
