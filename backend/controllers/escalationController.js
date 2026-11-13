const mongoose = require("mongoose");
const { listEscalatedReports, retryEscalatedReport } = require("../services/assignmentService");

async function getEscalatedReports(req, res, next) {
  try {
    for (const key of ["page", "limit"]) {
      if (req.query[key] && (!/^\d+$/.test(req.query[key]) || Number(req.query[key]) < 1)) {
        return res.status(422).json({ success: false, error: { code: "INVALID_PAGINATION", message: `${key} must be a positive integer.` } });
      }
    }
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Math.min(100, Number.parseInt(req.query.limit, 10) || 20);
    const result = await listEscalatedReports({ page, limit });
    return res.json({ success: true, data: result.data, pagination: result.pagination });
  } catch (error) { return next(error); }
}

async function retryEscalated(req, res, next) {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      return res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "The supplied report ID is invalid." } });
    }
    const result = await retryEscalatedReport(req.params.id);
    if (!result.eligible) {
      return res.status(409).json({ success: false, error: { code: "NOT_ESCALATED", message: "This report is no longer pending in the escalation queue." } });
    }
    return res.json({ success: true, data: result.report });
  } catch (error) { return next(error); }
}

module.exports = { getEscalatedReports, retryEscalated };
