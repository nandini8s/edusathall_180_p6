const mongoose = require("mongoose");
const Anomaly = require("../models/Anomaly");
const { validateStationCode, validateAnomalyCode } = require("../services/validationService");
const { classifyAnomaly } = require("../services/classificationService");
const { routeAnomaly } = require("../services/routingService");
const { canTransition } = require("../services/statusService");
const { releaseHandlerCapacity, httpError } = require("../services/handlerService");
const { attemptAssignment, retryEscalatedForHandler } = require("../services/assignmentService");
const { CATEGORIES } = require("../config/anomalyConfig");

const STATUSES = ["Pending", "Assigned", "In Progress", "Resolved"];

async function createAnomaly(req, res, next) {
  try {
    const { stationCode, anomalyCode, description } = req.body || {};
    const station = validateStationCode(stationCode);
    const anomaly = validateAnomalyCode(anomalyCode);
    const validationResult = {
      stationCode: { regexValid: station.regexValid, dfaValid: station.dfaValid },
      anomalyCode: { regexValid: anomaly.regexValid, dfaValid: anomaly.dfaValid },
    };
    if (!station.isValid || !anomaly.isValid) {
      return res.status(422).json({ success: false, error: { code: "INVALID_REPORT", message: "One or more report codes are invalid.", details: { stationCode: station, anomalyCode: anomaly } } });
    }
    if (typeof description !== "string" || description.trim().length < 5 || description.trim().length > 2000) {
      return res.status(422).json({ success: false, error: { code: "INVALID_DESCRIPTION", message: "Description must contain 5 to 2000 characters." } });
    }
    const { category, priority } = classifyAnomaly(anomaly.value);
    const routing = routeAnomaly(station.value, category);
    const session = await mongoose.startSession();
    let report;
    try {
      await session.withTransaction(async () => {
        const [created] = await Anomaly.create([{
          stationCode: station.value,
          anomalyCode: anomaly.value,
          category,
          priority,
          description: description.trim(),
          ...routing,
          primaryHandlerKey: routing.handlerKey,
          status: "Pending",
          isValid: true,
          validationResult,
        }], { session });
        await attemptAssignment(created, session);
        await created.save({ session });
        report = created;
      });
      return res.status(201).json({ success: true, data: report });
    } finally {
      await session.endSession();
    }
  } catch (error) { return next(error); }
}

async function listAnomalies(req, res, next) {
  try {
    const filter = {};
    const allowed = {
      category: CATEGORIES,
      priority: ["Critical", "High", "Medium", "Low"],
      status: STATUSES,
    };
    for (const [key, values] of Object.entries(allowed)) {
      if (req.query[key] && !values.includes(req.query[key])) {
        return res.status(422).json({ success: false, error: { code: "INVALID_FILTER", message: `Invalid ${key} filter.`, details: { allowed: values } } });
      }
      if (req.query[key]) filter[key] = req.query[key];
    }
    for (const key of ["page", "limit"]) {
      if (req.query[key] && (!/^\d+$/.test(req.query[key]) || Number(req.query[key]) < 1)) {
        return res.status(422).json({ success: false, error: { code: "INVALID_PAGINATION", message: `${key} must be a positive integer.` } });
      }
    }
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const [data, total] = await Promise.all([Anomaly.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), Anomaly.countDocuments(filter)]);
    return res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { return next(error); }
}

async function getAnomaly(req, res, next) {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "The supplied report ID is invalid." } });
    const data = await Anomaly.findById(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Anomaly report not found." } });
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
}

async function updateStatus(req, res, next) {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "The supplied report ID is invalid." } });
    const { status } = req.body || {};
    if (!STATUSES.includes(status)) return res.status(422).json({ success: false, error: { code: "INVALID_STATUS", message: `Status must be one of: ${STATUSES.join(", ")}.` } });
    const session = await mongoose.startSession();
    let updatedReport;
    let assignmentError;
    let releasedHandlerKey;
    try {
      await session.withTransaction(async () => {
        const report = await Anomaly.findById(req.params.id).session(session);
        if (!report) throw httpError(404, "NOT_FOUND", "Anomaly report not found.");
        if (!canTransition(report.status, status)) {
          throw httpError(409, "INVALID_STATUS_TRANSITION", `Cannot change status from ${report.status} to ${status}.`);
        }

        if (status === "Assigned") {
          const assignment = await attemptAssignment(report, session, { isRetry: true });
          await report.save({ session });
          if (!assignment.assigned) {
            assignmentError = httpError(409, "HANDLER_UNAVAILABLE", "No eligible handler is available; the report remains Pending and has been placed in the escalation queue.");
            return;
          }
          updatedReport = report;
          return;
        }

        if (status === "Resolved" && report.handlerId) {
          releasedHandlerKey = report.handlerKey;
          const released = await releaseHandlerCapacity(report.handlerId, report._id, session);
          if (!released) {
            throw httpError(409, "HANDLER_ASSIGNMENT_MISSING", "The assigned handler does not contain this active report; the status remains unchanged.");
          }
        }

        report.status = status;
        await report.save({ session });
        updatedReport = report;
      });
      if (assignmentError) return res.status(assignmentError.statusCode).json({ success: false, error: { code: assignmentError.code, message: assignmentError.message } });
      if (releasedHandlerKey) {
        try { await retryEscalatedForHandler(releasedHandlerKey); }
        catch (error) { console.error("Automatic escalation retry after resolution failed:", error.message); }
      }
      return res.json({ success: true, data: updatedReport });
    } finally {
      await session.endSession();
    }
  } catch (error) { return next(error); }
}

async function getStats(req, res, next) {
  try {
    const [total, categories, priorities, statuses] = await Promise.all([
      Anomaly.countDocuments(),
      Anomaly.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }]),
      Anomaly.aggregate([{ $group: { _id: "$priority", count: { $sum: 1 } } }]),
      Anomaly.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);
    const mapCounts = (rows) => Object.fromEntries(rows.map(({ _id, count }) => [_id, count]));
    return res.json({ success: true, data: { total, byCategory: mapCounts(categories), byPriority: mapCounts(priorities), byStatus: mapCounts(statuses) } });
  } catch (error) { return next(error); }
}

module.exports = { createAnomaly, listAnomalies, getAnomaly, updateStatus, getStats };
