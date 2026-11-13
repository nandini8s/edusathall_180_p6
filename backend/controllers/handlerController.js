const { listHandlers, updateHandler } = require("../services/handlerService");
const { retryEscalatedForHandler } = require("../services/assignmentService");

async function getHandlers(req, res, next) {
  try {
    const data = await listHandlers();
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
}

async function patchHandler(req, res, next) {
  try {
    const body = req.body || {};
    const allowed = new Set(["available", "maxCapacity"]);
    if (Object.keys(body).some((key) => !allowed.has(key))) {
      return res.status(422).json({
        success: false,
        error: { code: "INVALID_HANDLER_UPDATE", message: "Only available and maxCapacity can be updated." },
      });
    }
    const data = await updateHandler(req.params.key, body);
    try { await retryEscalatedForHandler(req.params.key); }
    catch (error) { console.error("Automatic escalation retry after handler update failed:", error.message); }
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
}

module.exports = { getHandlers, patchHandler };
