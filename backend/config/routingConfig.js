// Demonstration route names and initial handler defaults; not real metro contacts.
// Persisted availability and maxCapacity are managed through /api/handlers.
const NON_MEDICAL_CATEGORIES = Object.freeze(["Safety", "Technical", "Crowd", "Cleanliness"]);

const ROUTES_BY_PREFIX = Object.freeze({
  AB: Object.freeze({ corridor: "East Control Room", destination: "East Control Room", available: true, maxCapacity: 10, backupHandlerKeys: ["AB_BACKUP"] }),
  CD: Object.freeze({ corridor: "West Control Room", destination: "West Control Room", available: true, maxCapacity: 10, backupHandlerKeys: ["CD_BACKUP"] }),
  EF: Object.freeze({ corridor: "Central Control Room", destination: "Central Control Room", available: true, maxCapacity: 10, backupHandlerKeys: ["EF_BACKUP"] }),
});

// Configurable local demo backups. Each stays within its primary corridor and
// accepts the same non-medical categories. These are not official destinations.
const BACKUP_HANDLERS = Object.freeze({
  AB_BACKUP: Object.freeze({ corridor: "East Control Room", destination: "East Backup Handler (Demo)", available: true, maxCapacity: 5, primaryHandlerKey: "AB", eligibleCategories: NON_MEDICAL_CATEGORIES }),
  CD_BACKUP: Object.freeze({ corridor: "West Control Room", destination: "West Backup Handler (Demo)", available: true, maxCapacity: 5, primaryHandlerKey: "CD", eligibleCategories: NON_MEDICAL_CATEGORIES }),
  EF_BACKUP: Object.freeze({ corridor: "Central Control Room", destination: "Central Backup Handler (Demo)", available: true, maxCapacity: 5, primaryHandlerKey: "EF", eligibleCategories: NON_MEDICAL_CATEGORIES }),
});

const MEDICAL_ROUTE = Object.freeze({
  corridor: "Central Control Room",
  destination: "Central Emergency Line",
  available: true,
  maxCapacity: 10,
  eligibleCategories: ["Medical"],
  backupHandlerKeys: [],
});

module.exports = { ROUTES_BY_PREFIX, BACKUP_HANDLERS, MEDICAL_ROUTE, NON_MEDICAL_CATEGORIES };
