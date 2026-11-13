const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { validateStationCode, validateAnomalyCode } = require("../services/validationService");
const { classifyAnomaly } = require("../services/classificationService");
const { routeAnomaly } = require("../services/routingService");
const Handler = require("../models/Handler");
const Anomaly = require("../models/Anomaly");
const { reserveHandlerCapacity, updateHandler } = require("../services/handlerService");
const { canTransition } = require("../services/statusService");
const { DFA } = require("../utils/dfa");

function callCreate(body) {
  const { createAnomaly } = require("../controllers/anomalyController");
  const { errorHandler } = require("../middleware/errorMiddleware");
  const response = { statusCode: 200, body: null };
  let forwardedError = null;
  const req = { body };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(json) { response.body = json; return this; },
  };
  return createAnomaly(req, res, (error) => { forwardedError = error; }).then(() => {
    if (forwardedError) errorHandler(forwardedError, req, res, () => {});
    return response;
  });
}

async function withMockHandlers(seed, callback) {
  const originalFindOneAndUpdate = Handler.findOneAndUpdate;
  const originalExists = Handler.exists;
  const records = new Map(seed.map((handler) => [handler.key, { _id: handler.key, activeReportIds: [], ...handler }]));
  Handler.findOneAndUpdate = async (filter, update) => {
    const handler = filter.key ? records.get(filter.key) : [...records.values()].find((entry) => entry._id === filter._id);
    if (!handler) return null;
    if (filter.available !== undefined && handler.available !== filter.available) return null;
    const reportFilter = filter.activeReportIds;
    if (reportFilter?.$ne !== undefined && handler.activeReportIds.some((id) => String(id) === String(reportFilter.$ne))) return null;
    if (reportFilter !== undefined && reportFilter.$ne === undefined && !handler.activeReportIds.some((id) => String(id) === String(reportFilter))) return null;
    if (filter.$expr?.$lt && handler.activeReportIds.length >= handler.maxCapacity) return null;
    if (filter.$expr?.$lte && handler.activeReportIds.length > filter.$expr.$lte[1]) return null;
    if (update.$addToSet?.activeReportIds && !handler.activeReportIds.some((id) => String(id) === String(update.$addToSet.activeReportIds))) handler.activeReportIds.push(update.$addToSet.activeReportIds);
    if (update.$pull?.activeReportIds) handler.activeReportIds = handler.activeReportIds.filter((id) => String(id) !== String(update.$pull.activeReportIds));
    if (update.$set) Object.assign(handler, update.$set);
    return { ...handler, activeReportIds: [...handler.activeReportIds] };
  };
  Handler.exists = async ({ key }) => records.has(key);
  try { return await callback(records); }
  finally {
    Handler.findOneAndUpdate = originalFindOneAndUpdate;
    Handler.exists = originalExists;
  }
}

async function withMockStatusUpdate(report, status) {
  const { updateStatus } = require("../controllers/anomalyController");
  const originalStartSession = mongoose.startSession;
  const originalFindById = Anomaly.findById;
  const session = { withTransaction: async (work) => work(), endSession: async () => {} };
  mongoose.startSession = async () => session;
  Anomaly.findById = () => ({ session: async () => report });
  report.save = async () => report;
  const result = { statusCode: 200, body: null, error: null };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; },
  };
  try {
    await updateStatus(
      { params: { id: new mongoose.Types.ObjectId().toString() }, body: { status } },
      res,
      (error) => { result.error = error; },
    );
    return result;
  } finally {
    mongoose.startSession = originalStartSession;
    Anomaly.findById = originalFindById;
  }
}

test("AUD-01 station code accepts canonical form through Regex and DFA", () => {
  const result = validateStationCode("STAAB123");
  assert.deepEqual([result.isValid, result.regexValid, result.dfaValid], [true, true, true]);
});

test("AUD-02 station code trims surrounding whitespace", () => {
  assert.equal(validateStationCode(" STAAB123 ").isValid, true);
});

test("AUD-03 station code rejects lowercase letters", () => {
  const result = validateStationCode("STAab123");
  assert.deepEqual([result.isValid, result.regexValid, result.dfaValid], [false, false, false]);
});

test("AUD-04 station code rejects a short code", () => {
  assert.equal(validateStationCode("STAAB12").isValid, false);
});

test("AUD-05 station code rejects a wrong prefix", () => {
  assert.equal(validateStationCode("STXAB123").isValid, false);
});

test("AUD-06 station code rejects non-letter corridor characters", () => {
  assert.equal(validateStationCode("STA1B123").isValid, false);
});

test("AUD-07 anomaly code accepts the required three-character format via both checks", () => {
  const result = validateAnomalyCode("A01");
  assert.deepEqual([result.isValid, result.regexValid, result.dfaValid], [true, true, true]);
});

test("AUD-08 anomaly code accepts a well-formed but unmapped code at format-validation stage", () => {
  assert.equal(validateAnomalyCode("A99").isValid, true);
  assert.throws(() => classifyAnomaly("A99"), { code: "UNKNOWN_ANOMALY_CODE", statusCode: 422 });
});

test("AUD-09 anomaly code rejects one digit", () => {
  assert.equal(validateAnomalyCode("A1").isValid, false);
});

test("AUD-10 anomaly code rejects a trailing letter", () => {
  assert.equal(validateAnomalyCode("A0X").isValid, false);
});

test("AUD-11 anomaly code rejects lowercase prefix", () => {
  assert.equal(validateAnomalyCode("a01").isValid, false);
});

test("AUD-12 generic DFA accepts a complete valid transition path", () => {
  const dfa = new DFA([0, 1, 2], ["a", "b"], { 0: { a: 1 }, 1: { b: 2 } }, 0, [2]);
  assert.equal(dfa.accepts("ab"), true);
  assert.equal(dfa.run("ab"), 2);
});

test("AUD-13 generic DFA rejects incomplete and out-of-alphabet input", () => {
  const dfa = new DFA([0, 1, 2], ["a", "b"], { 0: { a: 1 }, 1: { b: 2 } }, 0, [2]);
  assert.equal(dfa.accepts("a"), false);
  assert.equal(dfa.accepts("ax"), false);
  assert.equal(dfa.run("ax"), null);
});

test("AUD-14 A01 maps to Medical / Critical", () => {
  assert.deepEqual(classifyAnomaly("A01"), { category: "Medical", priority: "Critical" });
});

test("AUD-15 A02 maps to Safety / High", () => {
  assert.deepEqual(classifyAnomaly("A02"), { category: "Safety", priority: "High" });
});

test("AUD-16 A03 maps to Technical / Medium", () => {
  assert.deepEqual(classifyAnomaly("A03"), { category: "Technical", priority: "Medium" });
});

test("AUD-17 A04 maps to Crowd / Low", () => {
  assert.deepEqual(classifyAnomaly("A04"), { category: "Crowd", priority: "Low" });
});

test("AUD-18 A05 maps to Cleanliness / Low", () => {
  assert.deepEqual(classifyAnomaly("A05"), { category: "Cleanliness", priority: "Low" });
});

test("AUD-19 AB prefix routes to East Control Room", () => {
  assert.deepEqual(routeAnomaly("STAAB123", "Safety").destination, "East Control Room");
});

test("AUD-20 CD prefix routes to West Control Room", () => {
  assert.equal(routeAnomaly("STACD123", "Safety").destination, "West Control Room");
});

test("AUD-21 EF prefix routes to Central Control Room", () => {
  assert.equal(routeAnomaly("STAEF123", "Safety").destination, "Central Control Room");
});

test("AUD-22 unconfigured station prefix returns UNKNOWN_STATION_ROUTE", () => {
  assert.throws(() => routeAnomaly("STAGH123", "Safety"), { code: "UNKNOWN_STATION_ROUTE", statusCode: 422 });
});

test("AUD-23 Medical overrides East corridor and goes to Central Emergency Line", () => {
  const result = routeAnomaly("STAAB123", "Medical");
  assert.deepEqual([result.corridor, result.destination, result.handlerKey], ["Central Control Room", "Central Emergency Line", "MEDICAL"]);
});

test("AUD-24 available handler reserves a report", async () => {
  await withMockHandlers([{ key: "AB", available: true, maxCapacity: 2 }], async (records) => {
    const reservation = await reserveHandlerCapacity("AB", "report-1");
    assert.ok(reservation);
    assert.deepEqual(records.get("AB").activeReportIds, ["report-1"]);
  });
});

test("AUD-25 unavailable handler receives no new reservation", async () => {
  await withMockHandlers([{ key: "AB", available: false, maxCapacity: 2 }], async (records) => {
    assert.equal(await reserveHandlerCapacity("AB", "report-1"), null);
    assert.deepEqual(records.get("AB").activeReportIds, []);
  });
});

test("AUD-26 handler at capacity receives no new reservation", async () => {
  await withMockHandlers([{ key: "AB", available: true, maxCapacity: 1, activeReportIds: ["existing"] }], async (records) => {
    assert.equal(await reserveHandlerCapacity("AB", "report-new"), null);
    assert.deepEqual(records.get("AB").activeReportIds, ["existing"]);
  });
});

test("AUD-27 status workflow accepts only the next sequential transition", () => {
  assert.equal(canTransition("Pending", "Assigned"), true);
  assert.equal(canTransition("Assigned", "In Progress"), true);
  assert.equal(canTransition("In Progress", "Resolved"), true);
});

test("AUD-28 status workflow rejects skipping, repeating, and reopening", () => {
  assert.equal(canTransition("Pending", "Resolved"), false);
  assert.equal(canTransition("Assigned", "Assigned"), false);
  assert.equal(canTransition("Resolved", "Assigned"), false);
});

test("AUD-29 API rejects malformed codes with validation detail before database access", async () => {
  const result = await callCreate({ stationCode: "STAAB12", anomalyCode: "A1", description: "valid description" });
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.error.code, "INVALID_REPORT");
  assert.equal(result.body.error.details.stationCode.regexValid, false);
  assert.equal(result.body.error.details.anomalyCode.dfaValid, false);
});

test("AUD-30 API rejects descriptions shorter than five trimmed characters", async () => {
  const result = await callCreate({ stationCode: "STAAB123", anomalyCode: "A01", description: "  ab " });
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.error.code, "INVALID_DESCRIPTION");
});

test("AUD-31 API rejects descriptions longer than 2000 characters", async () => {
  const result = await callCreate({ stationCode: "STAAB123", anomalyCode: "A01", description: "x".repeat(2001) });
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.error.code, "INVALID_DESCRIPTION");
});

test("AUD-32 API rejects a formatted but unmapped anomaly code", async () => {
  const result = await callCreate({ stationCode: "STAAB123", anomalyCode: "A99", description: "valid description" });
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.error.code, "UNKNOWN_ANOMALY_CODE");
});

test("AUD-33 API rejects valid codes with an unconfigured station route", async () => {
  const result = await callCreate({ stationCode: "STAGH123", anomalyCode: "A02", description: "valid description" });
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.error.code, "UNKNOWN_STATION_ROUTE");
});

test("AUD-34 Medical routing reserves the configured Central Emergency Line handler", async () => {
  const medicalRoute = routeAnomaly("STAAB123", "Medical");
  await withMockHandlers([{ key: medicalRoute.handlerKey, available: true, maxCapacity: 1 }], async (records) => {
    assert.ok(await reserveHandlerCapacity(medicalRoute.handlerKey, "medical-report"));
    assert.deepEqual(records.get("MEDICAL").activeReportIds, ["medical-report"]);
  });
});

test("AUD-35 concurrent reservations cannot exceed handler maximum capacity", async () => {
  await withMockHandlers([{ key: "AB", available: true, maxCapacity: 3 }], async (records) => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => reserveHandlerCapacity("AB", `report-${index}`)));
    assert.equal(results.filter(Boolean).length, 3);
    assert.equal(records.get("AB").activeReportIds.length, 3);
  });
});

test("AUD-36 duplicate reservations for one report do not consume capacity twice", async () => {
  await withMockHandlers([{ key: "AB", available: true, maxCapacity: 2 }], async (records) => {
    assert.ok(await reserveHandlerCapacity("AB", "same-report"));
    assert.equal(await reserveHandlerCapacity("AB", "same-report"), null);
    assert.deepEqual(records.get("AB").activeReportIds, ["same-report"]);
  });
});

test("AUD-37 resolving a report releases its capacity for another assignment", async () => {
  await withMockHandlers([{ key: "AB", available: true, maxCapacity: 1, activeReportIds: ["resolved-report"] }], async (records) => {
    const report = {
      _id: "resolved-report",
      stationCode: "STAAB123",
      category: "Safety",
      status: "In Progress",
      handlerKey: "AB",
      handlerId: "AB",
    };
    const response = await withMockStatusUpdate(report, "Resolved");
    assert.equal(response.error, null);
    assert.equal(response.body.data.status, "Resolved");
    assert.deepEqual(records.get("AB").activeReportIds, []);
    assert.ok(await reserveHandlerCapacity("AB", "next-report"));
    assert.deepEqual(records.get("AB").activeReportIds, ["next-report"]);
  });
});

test("AUD-38 station code rejects an extra digit in both Regex and DFA", () => {
  const result = validateStationCode("STAAB1234");
  assert.deepEqual([result.isValid, result.regexValid, result.dfaValid], [false, false, false]);
});

test("AUD-39 handler management updates availability and maximum capacity", async () => {
  await withMockHandlers([{ key: "AB", available: true, maxCapacity: 5, activeReportIds: ["a", "b"] }], async (records) => {
    const result = await updateHandler("AB", { available: false, maxCapacity: 3 });
    assert.equal(result.available, false);
    assert.equal(result.maxCapacity, 3);
    assert.equal(result.activeReportCount, 2);
    assert.deepEqual(records.get("AB").activeReportIds, ["a", "b"]);
  });
});

test("AUD-40 handler maximum cannot be reduced below active workload", async () => {
  await withMockHandlers([{ key: "AB", available: true, maxCapacity: 5, activeReportIds: ["a", "b"] }], async (records) => {
    await assert.rejects(updateHandler("AB", { maxCapacity: 1 }), { code: "HANDLER_CAPACITY_BELOW_WORKLOAD", statusCode: 409 });
    assert.equal(records.get("AB").maxCapacity, 5);
    assert.deepEqual(records.get("AB").activeReportIds, ["a", "b"]);
  });
});

test("AUD-41 Pending report reserves a handler atomically when moved to Assigned", async () => {
  await withMockHandlers([{ key: "AB", available: true, maxCapacity: 1 }], async (records) => {
    const report = { _id: "pending-1", stationCode: "STAAB123", category: "Safety", status: "Pending", handlerKey: "AB" };
    const response = await withMockStatusUpdate(report, "Assigned");
    assert.equal(response.error, null);
    assert.equal(response.body.data.status, "Assigned");
    assert.equal(response.body.data.handlerId, "AB");
    assert.deepEqual(records.get("AB").activeReportIds, ["pending-1"]);
  });
});

test("AUD-42 failed status assignment leaves Pending report and handler workload unchanged", async () => {
  await withMockHandlers([{ key: "AB", available: false, maxCapacity: 1 }], async (records) => {
    const report = { _id: "pending-2", stationCode: "STAAB123", category: "Safety", status: "Pending", handlerKey: "AB" };
    const response = await withMockStatusUpdate(report, "Assigned");
    assert.equal(response.error.code, "HANDLER_UNAVAILABLE");
    assert.equal(report.status, "Pending");
    assert.deepEqual(records.get("AB").activeReportIds, []);
  });
});
