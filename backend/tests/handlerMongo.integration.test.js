const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const mongoose = require("mongoose");

const Anomaly = require("../models/Anomaly");
const Handler = require("../models/Handler");
const { createAnomaly, updateStatus } = require("../controllers/anomalyController");
const { patchHandler } = require("../controllers/handlerController");
const escalationController = require("../controllers/escalationController");
const { errorHandler } = require("../middleware/errorMiddleware");
const { connectDB } = require("../config/db");
const { ensureConfiguredHandlers, listHandlers, reserveHandlerCapacity, updateHandler: setHandlerRecord } = require("../services/handlerService");
const { retryEscalatedReport } = require("../services/assignmentService");

async function invoke(controller, req) {
  const result = { statusCode: 200, body: null, error: null };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; },
  };
  await controller(req, res, (error) => { result.error = error; });
  if (result.error) errorHandler(result.error, req, res, () => {});
  return result;
}

test("live MongoDB handler capacity lifecycle", { skip: process.env.RUN_MONGO_INTEGRATION !== "1" }, async () => {
  require("dotenv").config({ path: path.join(__dirname, "../.env") });
  const token = `mongo-capacity-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let handler;
  let backup;
  let originalSettings;
  let backupSettings;
  let connected = false;
  try {
    await connectDB();
    connected = true;
    await ensureConfiguredHandlers();

    const handlers = await listHandlers();
    handler = handlers.find((candidate) => candidate.key === "AB");
    backup = handlers.find((candidate) => candidate.key === "AB_BACKUP");
    assert.ok(handler && backup, "Need configured AB primary and demonstration backup handlers.");
    assert.equal(handler.activeReportCount, 0, "AB primary must be idle to test safely.");
    assert.equal(backup.activeReportCount, 0, "AB backup must be idle to test safely.");
    originalSettings = { available: handler.available, maxCapacity: handler.maxCapacity };
    backupSettings = { available: backup.available, maxCapacity: backup.maxCapacity };

    const stationCode = "STAAB123";
    const anomalyCode = "A02";
    const createReport = async (label) => {
      const result = await invoke(createAnomaly, {
        body: { stationCode, anomalyCode, description: `${token} ${label} workload verification` },
      });
      assert.equal(result.statusCode, 201, JSON.stringify(result.body));
      assert.equal(result.body.success, true);
      return result.body.data;
    };
    const changeHandler = async (key, changes) => {
      const result = await invoke(patchHandler, { params: { key }, body: changes });
      assert.equal(result.statusCode, 200, JSON.stringify(result.body));
      return result.body.data;
    };
    const resolveReport = async (report) => {
      let result = await invoke(updateStatus, { params: { id: report._id }, body: { status: "In Progress" } });
      assert.equal(result.statusCode, 200, JSON.stringify(result.body));
      result = await invoke(updateStatus, { params: { id: report._id }, body: { status: "Resolved" } });
      assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    };
    const activeCount = async (key) => (await Handler.findOne({ key }).lean()).activeReportIds.length;

    await changeHandler(handler.key, { available: true, maxCapacity: Math.max(handler.maxCapacity, 2) });
    const firstPair = [await createReport("pair-one"), await createReport("pair-two")];
    assert.deepEqual(firstPair.map((report) => report.status), ["Assigned", "Assigned"]);
    assert.equal(await activeCount("AB"), 2, "Two successful reports should reserve two primary slots.");
    for (const report of firstPair) await resolveReport(report);
    assert.equal(await activeCount("AB"), 0, "Resolved reports should release their slots.");

    await changeHandler(handler.key, { available: false });
    await changeHandler(backup.key, { available: true, maxCapacity: 2 });
    const unavailableReport = await createReport("unavailable");
    assert.equal(unavailableReport.status, "Assigned");
    assert.equal(unavailableReport.assignmentRole, "backup");
    assert.equal(await activeCount("AB"), 0, "Unavailable primary must not receive a reservation.");
    assert.equal(await activeCount("AB_BACKUP"), 1, "Backup assignment must reserve workload atomically.");
    await resolveReport(unavailableReport);

    await changeHandler(handler.key, { available: true, maxCapacity: 1 });
    await changeHandler(backup.key, { available: false, maxCapacity: 1 });
    const capacityWinner = await createReport("capacity-one-winner");
    assert.equal(capacityWinner.status, "Assigned");
    assert.equal(await activeCount("AB"), 1);

    const duplicateSession = await mongoose.startSession();
    let duplicateReservation;
    try {
      await duplicateSession.withTransaction(async () => {
        duplicateReservation = await reserveHandlerCapacity(handler.key, capacityWinner._id, duplicateSession);
      });
    } finally { await duplicateSession.endSession(); }
    assert.equal(duplicateReservation, null, "A report already assigned to this handler must not reserve twice.");
    assert.equal(await activeCount("AB"), 1);

    const capacityLoser = await createReport("capacity-one-loser");
    assert.equal(capacityLoser.status, "Pending", "Current API behavior creates a Pending report when full.");
    assert.equal(await activeCount("AB"), 1);
    const retry = await invoke(updateStatus, { params: { id: capacityLoser._id }, body: { status: "Assigned" } });
    assert.equal(retry.statusCode, 409);
    assert.equal(retry.body.error.code, "HANDLER_UNAVAILABLE");
    assert.equal(await activeCount("AB"), 1);

    await resolveReport(capacityWinner);
    const releasedAndAssigned = await Anomaly.findById(capacityLoser._id).lean();
    assert.equal(releasedAndAssigned.status, "Assigned", "A released primary slot should automatically retry a waiting report.");
    assert.equal(await activeCount("AB"), 1, "The released slot should be reserved by the waiting report.");
    await resolveReport(releasedAndAssigned);
    assert.equal(await activeCount("AB"), 0, "Resolving the retried report should release its capacity-one slot.");

    await changeHandler(handler.key, { available: false });
    const escalated = await createReport("escalated-retry");
    assert.equal(escalated.status, "Pending");
    assert.equal(escalated.escalated, true);
    const queue = await invoke(escalationController.getEscalatedReports, { query: {} });
    assert.equal(queue.statusCode, 200);
    assert.ok(queue.body.data.some((report) => String(report._id) === String(escalated._id)), "Escalated reports should be returned by the list API.");
    const manualFailure = await invoke(escalationController.retryEscalated, { params: { id: escalated._id } });
    assert.equal(manualFailure.statusCode, 200);
    assert.equal(manualFailure.body.data.retryAttempts, 1);
    await changeHandler(backup.key, { available: true });
    const retried = await Anomaly.findById(escalated._id).lean();
    assert.equal(retried.status, "Assigned", `Availability changes should automatically retry eligible reports: ${JSON.stringify(retried)}`);
    assert.equal(retried.assignmentRole, "backup");
    assert.equal(retried.escalated, false);
    assert.equal(await activeCount("AB_BACKUP"), 1);
    const duplicateRetry = await invoke(escalationController.retryEscalated, { params: { id: escalated._id } });
    assert.equal(duplicateRetry.statusCode, 409, "A report already assigned by automatic retry cannot be assigned twice.");
    assert.equal(await activeCount("AB_BACKUP"), 1);
    await resolveReport(retried);

    await changeHandler(handler.key, { available: false });
    await changeHandler(backup.key, { available: false });
    const concurrent = await createReport("concurrent-retry");
    assert.equal(concurrent.status, "Pending");
    await setHandlerRecord(backup.key, { available: true });
    const concurrentResults = await Promise.all([
      invoke(escalationController.retryEscalated, { params: { id: concurrent._id } }),
      invoke(escalationController.retryEscalated, { params: { id: concurrent._id } }),
    ]);
    assert.equal(concurrentResults.filter((result) => result.statusCode === 200).length, 1);
    assert.equal(concurrentResults.filter((result) => result.statusCode === 409).length, 1);
    const concurrentAssigned = await Anomaly.findById(concurrent._id).lean();
    assert.equal(concurrentAssigned.status, "Assigned");
    assert.equal(concurrentAssigned.assignmentRole, "backup");
    assert.equal(await activeCount("AB_BACKUP"), 1, "Concurrent retries must reserve only one backup slot.");
    await resolveReport(concurrentAssigned);

  } finally {
    if (connected) {
      const created = await Anomaly.find({ description: new RegExp(`^${token}`) }).select("_id").lean();
      const ids = created.map((report) => report._id);
      if (ids.length) {
        await Handler.updateMany({ activeReportIds: { $in: ids } }, { $pull: { activeReportIds: { $in: ids } } });
        await Anomaly.deleteMany({ _id: { $in: ids } });
      }
      if (handler && originalSettings) {
        const current = await Handler.findById(handler._id).lean();
        const workload = current.activeReportIds.length;
        const restoredMaxCapacity = Math.max(originalSettings.maxCapacity, workload);
        await Handler.updateOne({ _id: handler._id }, {
          $set: {
            available: originalSettings.available,
            maxCapacity: restoredMaxCapacity,
          },
        });
        const restored = await Handler.findById(handler._id).lean();
        assert.equal(restored.available, originalSettings.available);
        assert.equal(restored.maxCapacity, restoredMaxCapacity);
      }
      if (backup && backupSettings) {
        const current = await Handler.findById(backup._id).lean();
        const restoredMaxCapacity = Math.max(backupSettings.maxCapacity, current.activeReportIds.length);
        await Handler.updateOne({ _id: backup._id }, { $set: { available: backupSettings.available, maxCapacity: restoredMaxCapacity } });
        const restored = await Handler.findById(backup._id).lean();
        assert.equal(restored.available, backupSettings.available);
        assert.equal(restored.maxCapacity, restoredMaxCapacity);
      }
      assert.equal(await Anomaly.countDocuments({ description: new RegExp(`^${token}`) }), 0, "Temporary integration reports must be removed.");
      await mongoose.disconnect();
    }
  }
});
