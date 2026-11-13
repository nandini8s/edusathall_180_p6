"""Unit tests for DFA and report-field validators; run with unittest."""

import unittest

from dfa import DFA, validate_station_code_dfa
from regex_validation import (
    validate_email,
    validate_phone,
    validate_report_id,
    validate_station_code,
)


class DFATests(unittest.TestCase):
    def setUp(self):
        # Accept binary strings ending in ``1``.
        self.dfa = DFA(
            states={"ends_in_0", "ends_in_1"},
            alphabet={"0", "1"},
            transitions={
                "ends_in_0": {"0": "ends_in_0", "1": "ends_in_1"},
                "ends_in_1": {"0": "ends_in_0", "1": "ends_in_1"},
            },
            start_state="ends_in_0",
            accept_states={"ends_in_1"},
        )

    def test_accepts_only_strings_ending_in_one(self):
        self.assertTrue(self.dfa.accepts("1"))
        self.assertTrue(self.dfa.accepts("101"))
        self.assertFalse(self.dfa.accepts(""))
        self.assertFalse(self.dfa.accepts("100"))
        self.assertFalse(self.dfa.accepts("10x"))

    def test_run_returns_final_state_or_none(self):
        self.assertEqual(self.dfa.run("101"), "ends_in_1")
        self.assertIsNone(self.dfa.run("10x"))

    def test_rejects_invalid_machine_definition(self):
        with self.assertRaises(ValueError):
            DFA({"a"}, {"0"}, {"a": {"0": "missing"}}, "a", set())


class RegexValidationTests(unittest.TestCase):
    def test_email(self):
        self.assertTrue(validate_email("rider@example.org"))
        self.assertFalse(validate_email("rider@localhost"))
        self.assertFalse(validate_email("not-an-email"))

    def test_phone(self):
        self.assertTrue(validate_phone("+1 (212) 555-0123"))
        self.assertFalse(validate_phone("123-abc-7890"))
        self.assertFalse(validate_phone("12345"))

    def test_station_code(self):
        valid_codes = ["STAAB123", "STAZZ000", "STAQQ999"]
        invalid_codes = [
            "STAab123",   # lowercase letters
            "STAAB12",    # missing digit
            "STAAB1234",  # extra digit
            "STXAB123",   # incorrect prefix
            "STAABC123",  # extra letter
            "STAAB12X",   # letter in digit position
            "",           # empty
        ]
        for code in valid_codes:
            with self.subTest(code=code):
                self.assertTrue(validate_station_code(code))
        for code in invalid_codes:
            with self.subTest(code=code):
                self.assertFalse(validate_station_code(code))
        self.assertTrue(validate_station_code(" STAAB123 "))

    def test_station_code_regex_and_dfa_agree(self):
        cases = [
            "STAAB123", "STAZZ000", "STAQQ999", "STAab123", "STAAB12",
            "STAAB1234", "STXAB123", "STAABC123", "STAAB12X", "",
        ]
        for code in cases:
            with self.subTest(code=code):
                self.assertEqual(validate_station_code(code), validate_station_code_dfa(code))

    def test_station_code_rejects_non_string_inputs(self):
        for value in (None, 123, b"STAAB123"):
            with self.subTest(value=value):
                self.assertFalse(validate_station_code(value))
                self.assertFalse(validate_station_code_dfa(value))

    def test_report_id(self):
        self.assertTrue(validate_report_id("mr-20260101"))
        self.assertFalse(validate_report_id("MR-12"))


if __name__ == "__main__":
    unittest.main()
