const { listHandlers, updateHandler } = require("../services/handlerService");

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
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
}

module.exports = { getHandlers, patchHandler };
