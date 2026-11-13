const mongoose = require("mongoose");
const Handler = require("../models/Handler");
const Anomaly = require("../models/Anomaly");
const { ROUTES_BY_PREFIX, MEDICAL_ROUTE } = require("../config/routingConfig");
const { routeAnomaly } = require("./routingService");

function configuredHandlers() {
  return [
    ...Object.entries(ROUTES_BY_PREFIX).map(([key, route]) => ({ key, ...route })),
    { key: "MEDICAL", ...MEDICAL_ROUTE },
  ];
}

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function ensureConfiguredHandlers() {
  await Promise.all(configuredHandlers().map(({ key, corridor, destination, available, maxCapacity }) =>
    Handler.updateOne(
      { key },
      {
        $set: { corridor, destination },
        $setOnInsert: { key, available, maxCapacity, activeReportIds: [] },
      },
      { upsert: true },
    ),
  ));
  await reconcileActiveReports();
}

async function reconcileActiveReports() {
  const activeReports = await Anomaly.find({
    status: { $in: ["Assigned", "In Progress"] },
    handlerId: { $exists: false },
  });
  for (const candidate of activeReports) {
    let route;
    try { route = routeAnomaly(candidate.stationCode, candidate.category); }
    catch { continue; }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const report = await Anomaly.findOne({
          _id: candidate._id,
          status: { $in: ["Assigned", "In Progress"] },
          handlerId: { $exists: false },
        }).session(session);
        if (!report) return;
        const handler = await Handler.findOne({ key: route.handlerKey }).session(session);
        if (!handler) return;
        await Handler.updateOne(
          { _id: handler._id },
          { $addToSet: { activeReportIds: report._id } },
          { session },
        );
        report.handlerKey = route.handlerKey;
        report.handlerId = handler._id;
        await report.save({ session });
      });
    } finally {
      await session.endSession();
    }
  }
}

async function reserveHandlerCapacity(key, reportId, session) {
  return Handler.findOneAndUpdate(
    {
      key,
      available: true,
      activeReportIds: { $ne: reportId },
      $expr: {
        $lt: [
          { $size: { $ifNull: ["$activeReportIds", []] } },
          "$maxCapacity",
        ],
      },
    },
    { $addToSet: { activeReportIds: reportId } },
    { returnDocument: "after", session },
  );
}

async function releaseHandlerCapacity(handlerId, reportId, session) {
  return Handler.findOneAndUpdate(
    { _id: handlerId, activeReportIds: reportId },
    { $pull: { activeReportIds: reportId } },
    { returnDocument: "after", session },
  );
}

async function listHandlers() {
  const handlers = await Handler.find({}).sort({ key: 1 }).lean();
  return handlers.map(handlerData);
}

function handlerData(handler) {
  const data = typeof handler.toObject === "function" ? handler.toObject() : handler;
  return { ...data, activeReportCount: (data.activeReportIds || []).length };
}

async function updateHandler(key, changes) {
  const update = {};
  if (Object.hasOwn(changes, "available")) {
    if (typeof changes.available !== "boolean") {
      throw httpError(422, "INVALID_HANDLER_UPDATE", "available must be a boolean.");
    }
    update.available = changes.available;
  }
  if (Object.hasOwn(changes, "maxCapacity")) {
    if (!Number.isInteger(changes.maxCapacity) || changes.maxCapacity < 0) {
      throw httpError(422, "INVALID_HANDLER_UPDATE", "maxCapacity must be a non-negative integer.");
    }
    update.maxCapacity = changes.maxCapacity;
  }
  if (Object.keys(update).length === 0) {
    throw httpError(422, "INVALID_HANDLER_UPDATE", "Provide available and/or maxCapacity.");
  }

  const filter = { key };
  if (Object.hasOwn(update, "maxCapacity")) {
    filter.$expr = {
      $lte: [
        { $size: { $ifNull: ["$activeReportIds", []] } },
        update.maxCapacity,
      ],
    };
  }
  const handler = await Handler.findOneAndUpdate(filter, { $set: update }, { returnDocument: "after", runValidators: true });
  if (handler) return handlerData(handler);

  const exists = await Handler.exists({ key });
  if (!exists) throw httpError(404, "HANDLER_NOT_FOUND", `Handler ${key} was not found.`);
  throw httpError(409, "HANDLER_CAPACITY_BELOW_WORKLOAD", "maxCapacity cannot be lower than the currently assigned active report count.");
}

module.exports = {
  ensureConfiguredHandlers,
  reconcileActiveReports,
  reserveHandlerCapacity,
  releaseHandlerCapacity,
  listHandlers,
  updateHandler,
  configuredHandlers,
  httpError,
};
