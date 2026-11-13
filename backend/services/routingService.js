const { ROUTES_BY_PREFIX, MEDICAL_ROUTE } = require("../config/routingConfig");

function getAssignmentPlan(stationCode, category, routeConfig = ROUTES_BY_PREFIX, medicalRoute = MEDICAL_ROUTE) {
  const handlerKey = category === "Medical" ? "MEDICAL" : stationCode.slice(3, 5);
  const route = category === "Medical" ? medicalRoute : routeConfig[handlerKey];

  if (!route) {
    const error = new Error(`No control-room route is configured for station prefix ${stationCode.slice(3, 5)}.`);
    error.statusCode = 422;
    error.code = "UNKNOWN_STATION_ROUTE";
    throw error;
  }

  return {
    primaryHandlerKey: handlerKey,
    backupHandlerKeys: category === "Medical" ? [] : [...(route.backupHandlerKeys || [])],
    corridor: route.corridor,
    destination: route.destination,
  };
}

function routeAnomaly(stationCode, category, routeConfig = ROUTES_BY_PREFIX, medicalRoute = MEDICAL_ROUTE) {
  const { primaryHandlerKey, corridor, destination } = getAssignmentPlan(stationCode, category, routeConfig, medicalRoute);
  return { corridor, destination, handlerKey: primaryHandlerKey };
}

module.exports = { routeAnomaly, getAssignmentPlan };
