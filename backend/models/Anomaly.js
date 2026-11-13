const mongoose = require("mongoose");
const { CATEGORIES } = require("../config/anomalyConfig");

const anomalySchema = new mongoose.Schema({
  stationCode: { type: String, required: true, uppercase: true, trim: true, match: /^STA[A-Z]{2}[0-9]{3}$/ },
  anomalyCode: { type: String, required: true, uppercase: true, trim: true, match: /^A[0-9]{2}$/ },
  category: { type: String, required: true, enum: CATEGORIES, index: true },
  priority: { type: String, required: true, enum: ["Critical", "High", "Medium", "Low"], index: true },
  description: { type: String, required: true, trim: true, minlength: 5, maxlength: 2000 },
  corridor: { type: String, required: true, trim: true },
  destination: { type: String, required: true, trim: true },
  handlerKey: { type: String, trim: true },
  handlerId: { type: mongoose.Schema.Types.ObjectId, ref: "Handler" },
  status: { type: String, required: true, enum: ["Pending", "Assigned", "In Progress", "Resolved"], default: "Pending", index: true },
  isValid: { type: Boolean, required: true, default: true },
  validationResult: {
    stationCode: { regexValid: { type: Boolean, required: true }, dfaValid: { type: Boolean, required: true } },
    anomalyCode: { regexValid: { type: Boolean, required: true }, dfaValid: { type: Boolean, required: true } },
  },
}, { timestamps: true });

anomalySchema.index({ createdAt: -1 });

module.exports = mongoose.models.Anomaly || mongoose.model("Anomaly", anomalySchema);
