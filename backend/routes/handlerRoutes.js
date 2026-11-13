const express = require("express");
const controller = require("../controllers/handlerController");

const router = express.Router();
router.get("/", controller.getHandlers);
router.patch("/:key", controller.patchHandler);

module.exports = router;
