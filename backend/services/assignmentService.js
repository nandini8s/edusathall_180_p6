const mongoose = require("mongoose");
const Anomaly = require("../models/Anomaly");
const Handler = require("../models/Handler");
const { getAssignmentPlan } = require("./routingService");
const { reserveHandlerCapacity, httpError } = require("./handlerService");

const MAX_AUTOMATIC_RETRIES = 8;

function pushAttempt(report, { handler, handlerKey, role, outcome, failureReason, attemptedAt }) {
  if (!Array.isArray(report.assignmentHistory)) report.assignmentHistory = [];
  report.assignmentHistory.push({
    handlerKey,
    handlerId: handler?._id,
    role,
    outcome,
    failureReason,
    attemptedAt,
  });
}

function makeEscalationReason(attempts) {
  return attempts.map(({ handlerKey, failureReason }) => `${handlerKey}: ${failureReason}`).join("; ");
}

async function attemptAssignment(report, session, { isRetry = false } = {}) {
  const plan = getAssignmentPlan(report.stationCode, report.category);
  report.primaryHandlerKey = plan.primaryHandlerKey;

  if (report.handlerId) {
    const linkedHandler = await Handler.findById(report.handlerId).session(session);
    if (linkedHandler && linkedHandler.activeReportIds.some((id) => String(id) === String(report._id))) {
      report.status = "Assigned";
      report.handlerKey = linkedHandler.key;
      report.assignmentRole = linkedHandler.role;
      report.destination = linkedHandler.destination;
      report.corridor = linkedHandler.corridor;
      report.escalated = false;
      if (isRetry) {
        report.retryAttempts += 1;
        report.lastRetryAt = new Date();
        report.lastRetryOutcome = linkedHandler.role === "backup" ? "assigned_backup" : "assigned_primary";
      }
      return { assigned: true, handlerKey: linkedHandler.key, role: linkedHandler.role, alreadyReserved: true };
    }
    return { assigned: false, reason: "Report already has a handler link without a matching active reservation." };
  }

  const alreadyReserved = await Handler.findOne({ activeReportIds: report._id }).session(session);
  if (alreadyReserved) {
    pushAttempt(report, {
      handler: alreadyReserved,
      handlerKey: alreadyReserved.key,
      role: alreadyReserved.role,
      outcome: "already_reserved",
      attemptedAt: new Date(),
    });
    report.handlerId = alreadyReserved._id;
    report.handlerKey = alreadyReserved.key;
    report.assignmentRole = alreadyReserved.role;
    report.destination = alreadyReserved.destination;
    report.corridor = alreadyReserved.corridor;
    report.status = "Assigned";
    report.escalated = false;
    if (isRetry) {
      report.retryAttempts += 1;
      report.lastRetryAt = new Date();
      report.lastRetryOutcome = alreadyReserved.role === "backup" ? "assigned_backup" : "assigned_primary";
    }
    return { assigned: true, handlerKey: alreadyReserved.key, role: alreadyReserved.role, alreadyReserved: true };
  }

  const candidates = [
    { key: plan.primaryHandlerKey, role: "primary" },
    ...plan.backupHandlerKeys.map((key) => ({ key, role: "backup" })),
  ];
  const failures = [];
  for (const candidate of candidates) {
    const now = new Date();
    const handler = await Handler.findOne({ key: candidate.key }).session(session);
    let failureReason = null;
    let outcome = null;

    if (!handler) {
      failureReason = "Handler is not configured.";
      outcome = "not_configured";
    } else if (handler.primaryHandlerKey !== plan.primaryHandlerKey
      || handler.role !== candidate.role
      || handler.corridor !== plan.corridor
      || !handler.eligibleCategories.includes(report.category)) {
      failureReason = "Handler is not eligible for this category and corridor.";
      outcome = "ineligible";
    } else {
      const reserved = await reserveHandlerCapacity(candidate.key, report._id, session);
      if (reserved) {
        pushAttempt(report, { handler: reserved, handlerKey: candidate.key, role: candidate.role, outcome: "assigned", attemptedAt: now });
        report.handlerKey = reserved.key;
        report.handlerId = reserved._id;
        report.assignmentRole = candidate.role;
        report.destination = reserved.destination;
        report.corridor = reserved.corridor;
        report.status = "Assigned";
        report.escalated = false;
        if (isRetry) {
          report.retryAttempts += 1;
          report.lastRetryAt = now;
          report.lastRetryOutcome = candidate.role === "backup" ? "assigned_backup" : "assigned_primary";
        }
        return { assigned: true, handlerKey: reserved.key, role: candidate.role };
      }

      const current = await Handler.findOne({ key: candidate.key }).session(session);
      if (!current) {
        failureReason = "Handler is not configured.";
        outcome = "not_configured";
      } else if (current.activeReportIds.some((id) => String(id) === String(report._id))) {
        pushAttempt(report, {
          handler: current,
          handlerKey: candidate.key,
          role: candidate.role,
          outcome: "already_reserved",
          attemptedAt: now,
        });
        report.handlerKey = current.key;
        report.handlerId = current._id;
        report.assignmentRole = candidate.role;
        report.destination = current.destination;
        report.corridor = current.corridor;
        report.status = "Assigned";
        report.escalated = false;
        return { assigned: true, handlerKey: current.key, role: candidate.role, alreadyReserved: true };
      } else if (!current.available) {
        failureReason = "Handler is unavailable.";
        outcome = "unavailable";
      } else if (current.activeReportIds.length >= current.maxCapacity) {
        failureReason = "Handler is at capacity.";
        outcome = "at_capacity";
      } else {
        failureReason = "Handler reservation could not be completed; it may already contain this report.";
        outcome = "already_reserved";
      }
    }

    pushAttempt(report, { handler, handlerKey: candidate.key, role: candidate.role, outcome, failureReason, attemptedAt: now });
    failures.push({ handlerKey: candidate.key, failureReason });
  }

  const now = new Date();
  report.status = "Pending";
  report.handlerKey = undefined;
  report.handlerId = undefined;
  report.assignmentRole = undefined;
  report.escalated = true;
  report.escalationReason = makeEscalationReason(failures) || "No eligible handler is configured.";
  report.escalatedAt = report.escalatedAt || now;
  if (isRetry) {
    report.retryAttempts += 1;
    report.lastRetryAt = now;
    report.lastRetryOutcome = "no_handler";
  }
  return { assigned: false, reason: report.escalationReason };
}

async function retryEscalatedReport(reportId, { automatic = false } = {}) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const report = await Anomaly.findById(reportId).session(session);
      if (!report) throw httpError(404, "NOT_FOUND", "Anomaly report not found.");
      if (report.status !== "Pending" || !report.escalated) {
        result = { eligible: false, report };
        return;
      }
      if (automatic && report.retryAttempts >= MAX_AUTOMATIC_RETRIES) {
        result = { eligible: false, exhausted: true, report };
        return;
      }
      const assignment = await attemptAssignment(report, session, { isRetry: true });
      await report.save({ session });
      result = { eligible: true, ...assignment, report };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function retryEscalatedForHandler(handlerKey) {
  const cursor = Anomaly.find({
    status: "Pending",
    escalated: true,
    retryAttempts: { $lt: MAX_AUTOMATIC_RETRIES },
  }).sort({ escalatedAt: 1, _id: 1 }).select("_id stationCode category primaryHandlerKey").lean().cursor();

  const summary = { considered: 0, assigned: 0, stillEscalated: 0, skipped: 0 };
  for await (const candidate of cursor) {
    const plan = getAssignmentPlan(candidate.stationCode, candidate.category);
    const candidateKeys = [plan.primaryHandlerKey, ...plan.backupHandlerKeys];
    if (handlerKey && !candidateKeys.includes(handlerKey)) continue;
    summary.considered += 1;
    const result = await retryEscalatedReport(candidate._id, { automatic: true });
    if (!result.eligible) summary.skipped += 1;
    else if (result.assigned) summary.assigned += 1;
    else summary.stillEscalated += 1;
  }
  return summary;
}

async function listEscalatedReports({ page = 1, limit = 20 } = {}) {
  const [data, total] = await Promise.all([
    Anomaly.find({ status: "Pending", escalated: true }).sort({ escalatedAt: 1, createdAt: 1 })
      .skip((page - 1) * limit).limit(limit),
    Anomaly.countDocuments({ status: "Pending", escalated: true }),
  ]);
  return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

module.exports = {
  MAX_AUTOMATIC_RETRIES,
  attemptAssignment,
  retryEscalatedReport,
  retryEscalatedForHandler,
  listEscalatedReports,
};
