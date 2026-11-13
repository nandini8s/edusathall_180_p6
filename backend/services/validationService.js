const { DFA } = require("../utils/dfa");

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const STATION_PATTERN = /^STA[A-Z]{2}[0-9]{3}$/;
const ANOMALY_PATTERN = /^A[0-9]{2}$/;

function positionalDFA(groups) {
  const states = groups.map((_, index) => index);
  states.push(groups.length);
  const alphabet = new Set(groups.flatMap((group) => [...group]));
  const transitions = {};
  groups.forEach((group, index) => {
    transitions[index] = Object.fromEntries([...group].map((symbol) => [symbol, index + 1]));
  });
  return new DFA(states, alphabet, transitions, 0, [groups.length]);
}

const stationDFA = positionalDFA(["S", "T", "A", LETTERS, LETTERS, DIGITS, DIGITS, DIGITS]);
const anomalyDFA = positionalDFA(["A", DIGITS, DIGITS]);

function validateCode(value, regex, dfa, label, expected) {
  const input = typeof value === "string" ? value.trim() : "";
  const regexValid = regex.test(input);
  const dfaValid = dfa.accepts(input);
  const isValid = regexValid && dfaValid;
  return {
    isValid,
    regexValid,
    dfaValid,
    value: input,
    error: isValid ? null : `${label} must match ${expected} (checked by both regex and DFA).`,
  };
}

const validateStationCode = (value) =>
  validateCode(value, STATION_PATTERN, stationDFA, "Station code", "STA[A-Z]{2}[0-9]{3}");
const validateAnomalyCode = (value) =>
  validateCode(value, ANOMALY_PATTERN, anomalyDFA, "Anomaly code", "A[0-9]{2}");

module.exports = { validateStationCode, validateAnomalyCode };
