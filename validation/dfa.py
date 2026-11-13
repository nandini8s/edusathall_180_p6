"""A small deterministic finite automaton implementation.

Transitions are supplied as ``{state: {symbol: next_state}}``. Symbols are
individual characters when :meth:`DFA.accepts` is given a string.
"""

from collections.abc import Hashable, Iterable, Mapping
from typing import TypeVar

State = TypeVar("State", bound=Hashable)


class DFA:
    """Represent and run a deterministic finite automaton."""

    def __init__(
        self,
        states: Iterable[State],
        alphabet: Iterable[str],
        transitions: Mapping[State, Mapping[str, State]],
        start_state: State,
        accept_states: Iterable[State],
    ) -> None:
        self.states = frozenset(states)
        self.alphabet = frozenset(alphabet)
        self.transitions = {state: dict(edges) for state, edges in transitions.items()}
        self.start_state = start_state
        self.accept_states = frozenset(accept_states)

        if start_state not in self.states:
            raise ValueError("start_state must be in states")
        if not self.accept_states <= self.states:
            raise ValueError("all accept_states must be in states")
        for state, edges in self.transitions.items():
            if state not in self.states:
                raise ValueError(f"transition source {state!r} is not a state")
            for symbol, destination in edges.items():
                if symbol not in self.alphabet:
                    raise ValueError(f"symbol {symbol!r} is not in the alphabet")
                if destination not in self.states:
                    raise ValueError(f"transition destination {destination!r} is not a state")

    def accepts(self, value: str) -> bool:
        """Return whether the entire string is accepted by this automaton."""
        state = self.start_state
        for symbol in value:
            if symbol not in self.alphabet:
                return False
            state = self.transitions.get(state, {}).get(symbol)
            if state is None:
                return False
        return state in self.accept_states

    def run(self, value: str) -> State | None:
        """Return the final state, or ``None`` if the input has no valid path."""
        state = self.start_state
        for symbol in value:
            if symbol not in self.alphabet:
                return None
            state = self.transitions.get(state, {}).get(symbol)
            if state is None:
                return None
        return state


_UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_DIGITS = "0123456789"
_STATION_GROUPS = ("S", "T", "A", _UPPERCASE, _UPPERCASE, _DIGITS, _DIGITS, _DIGITS)
_station_states = range(len(_STATION_GROUPS) + 1)
_station_alphabet = set("".join(_STATION_GROUPS))
_station_transitions = {
    state: {symbol: state + 1 for symbol in symbols}
    for state, symbols in enumerate(_STATION_GROUPS)
}
STATION_CODE_DFA = DFA(
    states=_station_states,
    alphabet=_station_alphabet,
    transitions=_station_transitions,
    start_state=0,
    accept_states={len(_STATION_GROUPS)},
)


def validate_station_code_dfa(value: str) -> bool:
    """Accept ``STA`` + two uppercase letters + three digits via DFA."""
    return isinstance(value, str) and STATION_CODE_DFA.accepts(value.strip())
