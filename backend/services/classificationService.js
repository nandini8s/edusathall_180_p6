const { ANOMALY_CODES, PRIORITIES } = require("../config/anomalyConfig");

function classifyAnomaly(anomalyCode) {
  const category = ANOMALY_CODES[anomalyCode];
  if (!category) {
    const error = new Error(`Anomaly code ${anomalyCode} has no configured category.`);
    error.statusCode = 422;
    error.code = "UNKNOWN_ANOMALY_CODE";
    throw error;
  }
  return { category, priority: PRIORITIES[category] };
}

module.exports = { classifyAnomaly };
