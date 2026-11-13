class DFA {
  constructor(states, alphabet, transitions, startState, acceptStates) {
    this.states = new Set(states);
    this.alphabet = new Set(alphabet);
    this.transitions = transitions;
    this.startState = startState;
    this.acceptStates = new Set(acceptStates);
    if (!this.states.has(startState) || [...this.acceptStates].some((state) => !this.states.has(state))) {
      throw new TypeError("DFA start and accept states must be declared states");
    }
  }

  run(input) {
    let state = this.startState;
    for (const symbol of input) {
      if (!this.alphabet.has(symbol)) return null;
      state = this.transitions[state]?.[symbol] ?? null;
      if (state === null) return null;
    }
    return state;
  }

  accepts(input) {
    if (typeof input !== "string") return false;
    const finalState = this.run(input);
    return finalState !== null && this.acceptStates.has(finalState);
  }
}

module.exports = { DFA };
