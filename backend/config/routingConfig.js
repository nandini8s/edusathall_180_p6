// Demonstration route names and initial handler defaults; not real metro contacts.
// Persisted availability and maxCapacity are managed through /api/handlers.
const ROUTES_BY_PREFIX = Object.freeze({
  AB: Object.freeze({ corridor: "East Control Room", destination: "East Control Room", available: true, maxCapacity: 10 }),
  CD: Object.freeze({ corridor: "West Control Room", destination: "West Control Room", available: true, maxCapacity: 10 }),
  EF: Object.freeze({ corridor: "Central Control Room", destination: "Central Control Room", available: true, maxCapacity: 10 }),
});

const MEDICAL_ROUTE = Object.freeze({
  corridor: "Central Control Room",
  destination: "Central Emergency Line",
  available: true,
  maxCapacity: 10,
});

module.exports = { ROUTES_BY_PREFIX, MEDICAL_ROUTE };
