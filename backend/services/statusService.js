const ALLOWED_TRANSITIONS = Object.freeze({
  Pending: Object.freeze(["Assigned"]),
  Assigned: Object.freeze(["In Progress"]),
  "In Progress": Object.freeze(["Resolved"]),
  Resolved: Object.freeze([]),
});

function canTransition(current, next) {
  return Boolean(ALLOWED_TRANSITIONS[current]?.includes(next));
}

module.exports = { ALLOWED_TRANSITIONS, canTransition };
