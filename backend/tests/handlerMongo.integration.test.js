const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const mongoose = require("mongoose");

const Anomaly = require("../models/Anomaly");
const Handler = require("../models/Handler");
const { createAnomaly, updateStatus } = require("../controllers/anomalyController");
const { errorHandler } = require("../middleware/errorMiddleware");
const { connectDB } = require("../config/db");
const { ensureConfiguredHandlers, listHandlers, updateHandler, reserveHandlerCapacity } = require("../services/handlerService");

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
  let originalSettings;
  let connected = false;
  try {
    await connectDB();
    connected = true;
    await ensureConfiguredHandlers();

    const handlers = await listHandlers();
    handler = handlers.find((candidate) => candidate.activeReportCount === 0);
    assert.ok(handler, "Need an idle configured demo handler to test capacity one safely.");
    originalSettings = { available: handler.available, maxCapacity: handler.maxCapacity };

    const medical = handler.key === "MEDICAL";
    const stationCode = handler.key === "CD" ? "STACD123" : handler.key === "EF" ? "STAEF123" : "STAAB123";
    const anomalyCode = medical ? "A01" : "A02";
    const createReport = async (label) => {
      const result = await invoke(createAnomaly, {
        body: { stationCode, anomalyCode, description: `${token} ${label} workload verification` },
      });
      assert.equal(result.statusCode, 201, JSON.stringify(result.body));
      assert.equal(result.body.success, true);
      return result.body.data;
    };
    const resolveReport = async (report) => {
      let result = await invoke(updateStatus, { params: { id: report._id }, body: { status: "In Progress" } });
      assert.equal(result.statusCode, 200, JSON.stringify(result.body));
      result = await invoke(updateStatus, { params: { id: report._id }, body: { status: "Resolved" } });
      assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    };
    const activeCount = async () => (await Handler.findById(handler._id).lean()).activeReportIds.length;

    await updateHandler(handler.key, { available: true, maxCapacity: Math.max(handler.maxCapacity, 2) });
    const firstPair = [await createReport("pair-one"), await createReport("pair-two")];
    assert.deepEqual(firstPair.map((report) => report.status), ["Assigned", "Assigned"]);
    assert.equal(await activeCount(), 2, "Two successful reports should reserve two active slots.");
    for (const report of firstPair) await resolveReport(report);
    assert.equal(await activeCount(), 0, "Resolved reports should release their slots.");

    await updateHandler(handler.key, { available: false });
    const unavailableReport = await createReport("unavailable");
    assert.equal(unavailableReport.status, "Pending");
    assert.equal(await activeCount(), 0, "Unavailable handler must not receive a reservation.");

    await updateHandler(handler.key, { available: true, maxCapacity: 1 });
    const capacityWinner = await createReport("capacity-one-winner");
    assert.equal(capacityWinner.status, "Assigned");
    assert.equal(await activeCount(), 1);

    const duplicateSession = await mongoose.startSession();
    let duplicateReservation;
    try {
      await duplicateSession.withTransaction(async () => {
        duplicateReservation = await reserveHandlerCapacity(handler.key, capacityWinner._id, duplicateSession);
      });
    } finally { await duplicateSession.endSession(); }
    assert.equal(duplicateReservation, null, "A report already assigned to this handler must not reserve twice.");
    assert.equal(await activeCount(), 1);

    const capacityLoser = await createReport("capacity-one-loser");
    assert.equal(capacityLoser.status, "Pending", "Current API behavior creates a Pending report when full.");
    assert.equal(await activeCount(), 1);
    const retry = await invoke(updateStatus, { params: { id: capacityLoser._id }, body: { status: "Assigned" } });
    assert.equal(retry.statusCode, 409);
    assert.equal(retry.body.error.code, "HANDLER_UNAVAILABLE");
    assert.equal(await activeCount(), 1);

    await resolveReport(capacityWinner);
    assert.equal(await activeCount(), 0, "Resolving the assigned report should release the capacity-one slot.");
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
      assert.equal(await Anomaly.countDocuments({ description: new RegExp(`^${token}`) }), 0, "Temporary integration reports must be removed.");
      await mongoose.disconnect();
    }
  }
});
