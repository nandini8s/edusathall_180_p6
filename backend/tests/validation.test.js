const test = require("node:test");
const assert = require("node:assert/strict");
const { validateStationCode, validateAnomalyCode } = require("../services/validationService");
const { classifyAnomaly } = require("../services/classificationService");
const { routeAnomaly } = require("../services/routingService");
const { canTransition } = require("../services/statusService");
const { DFA } = require("../utils/dfa");

test("station format is checked by regex and DFA", () => {
  for (const code of ["STAAB123", "STACD456"]) {
    const result = validateStationCode(code);
    assert.equal(result.isValid, true);
    assert.equal(result.regexValid, true);
    assert.equal(result.dfaValid, true);
  }
  for (const code of ["STA123", "STAAB12", "STAab123"]) {
    const result = validateStationCode(code);
    assert.equal(result.isValid, false);
    assert.equal(result.regexValid, false);
    assert.equal(result.dfaValid, false);
  }
});

test("anomaly format is checked by regex and DFA", () => {
  for (const code of ["A01", "A02", "A99"]) {
    assert.equal(validateAnomalyCode(code).isValid, true);
    assert.equal(validateAnomalyCode(code).regexValid, true);
    assert.equal(validateAnomalyCode(code).dfaValid, true);
  }
  for (const code of ["A1", "AB1", "A001"]) {
    assert.equal(validateAnomalyCode(code).isValid, false);
  }
});

test("DFA follows explicit deterministic transitions", () => {
  const dfa = new DFA([0, 1, 2], ["a", "b"], { 0: { a: 1 }, 1: { b: 2 } }, 0, [2]);
  assert.equal(dfa.accepts("ab"), true);
  assert.equal(dfa.accepts("aa"), false);
  assert.equal(dfa.accepts("ax"), false);
});

test("configured anomaly codes classify and receive the required priority", () => {
  assert.deepEqual(classifyAnomaly("A01"), { category: "Medical", priority: "Critical" });
  assert.deepEqual(classifyAnomaly("A02"), { category: "Safety", priority: "High" });
  assert.deepEqual(classifyAnomaly("A03"), { category: "Technical", priority: "Medium" });
  assert.deepEqual(classifyAnomaly("A04"), { category: "Crowd", priority: "Low" });
  assert.deepEqual(classifyAnomaly("A05"), { category: "Cleanliness", priority: "Low" });
  assert.throws(() => classifyAnomaly("A99"), { code: "UNKNOWN_ANOMALY_CODE", statusCode: 422 });
});

test("station prefixes route to configured control rooms", () => {
  assert.deepEqual(routeAnomaly("STAAB123", "Safety"), { corridor: "East Control Room", destination: "East Control Room", handlerKey: "AB" });
  assert.deepEqual(routeAnomaly("STACD456", "Safety"), { corridor: "West Control Room", destination: "West Control Room", handlerKey: "CD" });
  assert.deepEqual(routeAnomaly("STAEF789", "Safety"), { corridor: "Central Control Room", destination: "Central Control Room", handlerKey: "EF" });
});

test("medical routing overrides station prefix", () => {
  const medical = routeAnomaly("STAAB123", "Medical");
  assert.deepEqual(medical, { corridor: "Central Control Room", destination: "Central Emergency Line", handlerKey: "MEDICAL" });
});

test("status transitions permit only the defined next step", () => {
  assert.equal(canTransition("Pending", "Assigned"), true);
  assert.equal(canTransition("Assigned", "In Progress"), true);
  assert.equal(canTransition("In Progress", "Resolved"), true);
  assert.equal(canTransition("Pending", "Resolved"), false);
  assert.equal(canTransition("Resolved", "Assigned"), false);
});

test("API controller rejects malformed request before database access", async () => {
  const { createAnomaly } = require("../controllers/anomalyController");
  const result = { statusCode: null, body: null };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; },
  };
  await createAnomaly({ body: { stationCode: "STA123", anomalyCode: "A1", description: "A test issue" } }, res, (error) => { throw error; });
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.success, false);
  assert.equal(result.body.error.code, "INVALID_REPORT");
  assert.equal(result.body.error.details.stationCode.dfaValid, false);
  assert.equal(result.body.error.details.anomalyCode.regexValid, false);
});
