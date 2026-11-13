// Demonstration mapping. Replace these codes with the agency's approved codebook.
// Validly formatted codes absent from this map are deliberately treated as unknown.
const ANOMALY_CODES = Object.freeze({
  A01: "Medical",
  A02: "Safety",
  A03: "Technical",
  A04: "Crowd",
  A05: "Cleanliness",
});

const CATEGORIES = Object.freeze([
  "Medical",
  "Safety",
  "Technical",
  "Crowd",
  "Cleanliness",
]);

const PRIORITIES = Object.freeze({
  Medical: "Critical",
  Safety: "High",
  Technical: "Medium",
  Crowd: "Low",
  Cleanliness: "Low",
});

module.exports = { ANOMALY_CODES, CATEGORIES, PRIORITIES };
