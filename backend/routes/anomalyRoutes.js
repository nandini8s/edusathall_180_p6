const express = require("express");
const controller = require("../controllers/anomalyController");
const router = express.Router();
router.post("/", controller.createAnomaly);
router.get("/", controller.listAnomalies);
router.get("/stats", controller.getStats);
router.get("/:id", controller.getAnomaly);
router.patch("/:id/status", controller.updateStatus);
module.exports = router;
