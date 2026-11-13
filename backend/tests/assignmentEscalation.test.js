const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Handler = require("../models/Handler");
const Anomaly = require("../models/Anomaly");
const { routeAnomaly, getAssignmentPlan } = require("../services/routingService");
const { attemptAssignment, retryEscalatedReport, MAX_AUTOMATIC_RETRIES } = require("../services/assignmentService");

const NON_MEDICAL = ["Safety", "Technical", "Crowd", "Cleanliness"];
const query = (value) => ({ session: async () => value });

function demoHandler(key, { role = "primary", available = true, maxCapacity = 5, activeReportIds = [] } = {}) {
  const backup = role === "backup";
  return {
    _id: `${key}-id`, key, role, primaryHandlerKey: backup ? key.split("_")[0] : key,
    corridor: key.startsWith("AB") ? "East Control Room" : key === "MEDICAL" ? "Central Control Room" : "West Control Room",
    destination: key === "MEDICAL" ? "Central Emergency Line" : backup ? `${key} Handler (Demo)` : `${key} Control Room`,
    eligibleCategories: key === "MEDICAL" ? ["Medical"] : NON_MEDICAL,
    available, maxCapacity, activeReportIds: [...activeReportIds],
  };
}

async function withHandlers(seed, callback) {
  const originals = {
    findOne: Handler.findOne,
    findById: Handler.findById,
    findOneAndUpdate: Handler.findOneAndUpdate,
  };
  const handlers = new Map(seed.map((handler) => [handler.key, handler]));
  const find = (filter) => [...handlers.values()].find((handler) => {
    if (filter.key && handler.key !== filter.key) return false;
    if (filter._id && handler._id !== filter._id) return false;
    if (filter.activeReportIds && !handler.activeReportIds.some((id) => String(id) === String(filter.activeReportIds))) return false;
    return true;
  }) || null;

  Handler.findOne = (filter) => query(find(filter));
  Handler.findById = (id) => query([...handlers.values()].find((handler) => String(handler._id) === String(id)) || null);
  Handler.findOneAndUpdate = async (filter, update) => {
    const handler = filter.key ? handlers.get(filter.key) : [...handlers.values()].find((item) => item._id === filter._id);
    if (!handler || (filter.available !== undefined && handler.available !== filter.available)) return null;
    if (filter.activeReportIds?.$ne !== undefined && handler.activeReportIds.some((id) => String(id) === String(filter.activeReportIds.$ne))) return null;
    if (filter.activeReportIds !== undefined && filter.activeReportIds.$ne === undefined && !handler.activeReportIds.some((id) => String(id) === String(filter.activeReportIds))) return null;
    if (filter.$expr?.$lt && handler.activeReportIds.length >= handler.maxCapacity) return null;
    if (filter.$expr?.$lte && handler.activeReportIds.length > filter.$expr.$lte[1]) return null;
    const id = update.$addToSet?.activeReportIds;
    if (id !== undefined && !handler.activeReportIds.some((current) => String(current) === String(id))) handler.activeReportIds.push(id);
    const remove = update.$pull?.activeReportIds;
    if (remove !== undefined) handler.activeReportIds = handler.activeReportIds.filter((current) => String(current) !== String(remove));
    if (update.$set) Object.assign(handler, update.$set);
    return { ...handler, activeReportIds: [...handler.activeReportIds] };
  };
  try { return await callback(handlers); }
  finally {
    Handler.findOne = originals.findOne;
    Handler.findById = originals.findById;
    Handler.findOneAndUpdate = originals.findOneAndUpdate;
  }
}

function pendingReport({ id = "report-1", stationCode = "STAAB123", anomalyCode = "A02", category = "Safety" } = {}) {
  return {
    _id: id, stationCode, anomalyCode, category, corridor: "East Control Room", destination: "East Control Room",
    priority: category === "Medical" ? "Critical" : "High",
    status: "Pending", primaryHandlerKey: "AB", assignmentHistory: [], escalated: false, retryAttempts: 0,
    save: async function save() { return this; },
  };
}

test("backup cfg maps only same-corridor demo handlers for non-medical routes", () => {
  const plan = getAssignmentPlan("STAAB123", "Safety");
  assert.deepEqual(plan.backupHandlerKeys, ["AB_BACKUP"]);
  assert.equal(routeAnomaly("STAAB123", "Safety").handlerKey, "AB");
});

test("primary handler available receives the report", async () => {
  await withHandlers([demoHandler("AB"), demoHandler("AB_BACKUP", { role: "backup" })], async (handlers) => {
    const report = pendingReport();
    const result = await attemptAssignment(report, null);
    assert.equal(result.assigned, true);
    assert.equal(report.assignmentRole, "primary");
    assert.equal(handlers.get("AB").activeReportIds.length, 1);
    assert.equal(handlers.get("AB_BACKUP").activeReportIds.length, 0);
  });
});

test("primary unavailable assigns to eligible backup", async () => {
  await withHandlers([demoHandler("AB", { available: false }), demoHandler("AB_BACKUP", { role: "backup" })], async (handlers) => {
    const report = pendingReport();
    await attemptAssignment(report, null);
    assert.equal(report.status, "Assigned");
    assert.equal(report.assignmentRole, "backup");
    assert.equal(report.handlerKey, "AB_BACKUP");
    assert.equal(report.destination, "AB_BACKUP Handler (Demo)");
    assert.equal(handlers.get("AB_BACKUP").activeReportIds.length, 1);
  });
});

test("primary full assigns to backup and reserves backup capacity", async () => {
  await withHandlers([
    demoHandler("AB", { maxCapacity: 1, activeReportIds: ["existing"] }),
    demoHandler("AB_BACKUP", { role: "backup", maxCapacity: 1 }),
  ], async (handlers) => {
    const report = pendingReport();
    await attemptAssignment(report, null);
    assert.equal(report.assignmentRole, "backup");
    assert.deepEqual(handlers.get("AB_BACKUP").activeReportIds, ["report-1"]);
  });
});

test("both primary and backup unavailable escalate report as Pending", async () => {
  await withHandlers([
    demoHandler("AB", { available: false }),
    demoHandler("AB_BACKUP", { role: "backup", available: false }),
  ], async (handlers) => {
    const report = pendingReport();
    await attemptAssignment(report, null);
    assert.equal(report.status, "Pending");
    assert.equal(report.escalated, true);
    assert.match(report.escalationReason, /AB.*unavailable.*AB_BACKUP.*unavailable/);
    assert.equal(handlers.get("AB").activeReportIds.length + handlers.get("AB_BACKUP").activeReportIds.length, 0);
  });
});

test("both primary and backup at capacity escalate report", async () => {
  await withHandlers([
    demoHandler("AB", { maxCapacity: 1, activeReportIds: ["p"] }),
    demoHandler("AB_BACKUP", { role: "backup", maxCapacity: 1, activeReportIds: ["b"] }),
  ], async () => {
    const report = pendingReport();
    await attemptAssignment(report, null);
    assert.equal(report.escalated, true);
    assert.match(report.escalationReason, /at capacity/);
    assert.deepEqual(report.assignmentHistory.map((attempt) => attempt.outcome), ["at_capacity", "at_capacity"]);
  });
});

test("medical assignment never attempts ordinary backup handlers", async () => {
  const medicalPlan = getAssignmentPlan("STAAB123", "Medical");
  assert.deepEqual(medicalPlan.backupHandlerKeys, []);
  await withHandlers([demoHandler("MEDICAL", { available: false }), demoHandler("AB_BACKUP", { role: "backup" })], async (handlers) => {
    const report = pendingReport({ id: "medical-1", anomalyCode: "A01", category: "Medical" });
    await attemptAssignment(report, null);
    assert.equal(report.priority, "Critical");
    assert.equal(report.escalated, true);
    assert.equal(handlers.get("AB_BACKUP").activeReportIds.length, 0);
    assert.equal(report.assignmentHistory.length, 1);
    assert.equal(report.assignmentHistory[0].handlerKey, "MEDICAL");
  });
});

test("assignment history records primary failure and selected backup with roles and timestamps", async () => {
  await withHandlers([demoHandler("AB", { available: false }), demoHandler("AB_BACKUP", { role: "backup" })], async () => {
    const report = pendingReport();
    await attemptAssignment(report, null);
    assert.deepEqual(report.assignmentHistory.map(({ handlerKey, role, outcome }) => [handlerKey, role, outcome]), [
      ["AB", "primary", "unavailable"],
      ["AB_BACKUP", "backup", "assigned"],
    ]);
    assert.ok(report.assignmentHistory.every((attempt) => attempt.attemptedAt instanceof Date));
    assert.equal(report.assignmentHistory.at(-1).handlerId, "AB_BACKUP-id");
  });
});

test("escalated assignment retries successfully on backup and records retry outcome", async () => {
  await withHandlers([demoHandler("AB", { available: false }), demoHandler("AB_BACKUP", { role: "backup", available: false })], async (handlers) => {
    const report = pendingReport({ id: "retry-1" });
    report.save = async () => report;
    await attemptAssignment(report, null);
    const originalStartSession = mongoose.startSession;
    const originalFindById = Anomaly.findById;
    mongoose.startSession = async () => ({ withTransaction: async (work) => work(), endSession: async () => {} });
    Anomaly.findById = () => query(report);
    try {
      handlers.get("AB_BACKUP").available = true;
      const result = await retryEscalatedReport(report._id);
      assert.equal(result.assigned, true);
      assert.equal(report.assignmentRole, "backup");
      assert.equal(report.escalated, false);
      assert.equal(report.retryAttempts, 1);
      assert.equal(report.lastRetryOutcome, "assigned_backup");
      assert.equal(handlers.get("AB_BACKUP").activeReportIds.length, 1);
    } finally {
      mongoose.startSession = originalStartSession;
      Anomaly.findById = originalFindById;
    }
  });
});

test("concurrent retries of one escalated report produce at most one assignment", async () => {
  await withHandlers([demoHandler("AB", { available: false }), demoHandler("AB_BACKUP", { role: "backup", available: false })], async (handlers) => {
    const report = pendingReport({ id: "retry-concurrent" });
    report.save = async () => report;
    await attemptAssignment(report, null);
    const originalStartSession = mongoose.startSession;
    const originalFindById = Anomaly.findById;
    let transactionQueue = Promise.resolve();
    mongoose.startSession = async () => ({
      withTransaction: async (work) => {
        const previous = transactionQueue;
        let release;
        transactionQueue = new Promise((resolve) => { release = resolve; });
        await previous;
        try { return await work(); } finally { release(); }
      },
      endSession: async () => {},
    });
    Anomaly.findById = () => query(report);
    try {
      handlers.get("AB_BACKUP").available = true;
      const results = await Promise.all([
        retryEscalatedReport(report._id),
        retryEscalatedReport(report._id),
      ]);
      assert.equal(results.filter((result) => result.assigned).length, 1);
      assert.equal(handlers.get("AB_BACKUP").activeReportIds.filter((id) => id === report._id).length, 1);
      assert.equal(report.assignmentHistory.filter((attempt) => attempt.outcome === "assigned").length, 1);
    } finally {
      mongoose.startSession = originalStartSession;
      Anomaly.findById = originalFindById;
    }
  });
});

test("automatic retries stop at the configured finite limit", async () => {
  const report = pendingReport({ id: "retry-limit" });
  report.retryAttempts = MAX_AUTOMATIC_RETRIES;
  report.escalated = true;
  const originalStartSession = mongoose.startSession;
  const originalFindById = Anomaly.findById;
  mongoose.startSession = async () => ({ withTransaction: async (work) => work(), endSession: async () => {} });
  Anomaly.findById = () => query(report);
  try {
    const result = await retryEscalatedReport(report._id, { automatic: true });
    assert.equal(result.eligible, false);
    assert.equal(result.exhausted, true);
    assert.equal(report.retryAttempts, MAX_AUTOMATIC_RETRIES);
  } finally {
    mongoose.startSession = originalStartSession;
    Anomaly.findById = originalFindById;
  }
});
