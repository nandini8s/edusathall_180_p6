"""Regular-expression validators for common metro incident report fields."""

import re

_EMAIL = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$")
_PHONE = re.compile(r"^\+?[0-9][0-9 ()-]{6,19}$")
_STATION_CODE = re.compile(r"^STA[A-Z]{2}[0-9]{3}$")
_REPORT_ID = re.compile(r"^[A-Z]{2,6}-[0-9]{4,12}$")


def validate_email(value: str) -> bool:
    """Check a basic email address shape suitable for form validation."""
    return isinstance(value, str) and _EMAIL.fullmatch(value.strip()) is not None


def validate_phone(value: str) -> bool:
    """Check a phone number containing 7–20 digits and common separators."""
    if not isinstance(value, str):
        return False
    candidate = value.strip()
    digits = sum(character.isdigit() for character in candidate)
    return 7 <= digits <= 20 and _PHONE.fullmatch(candidate) is not None


def validate_station_code(value: str) -> bool:
    """Accept ``STA`` + two uppercase letters + three digits via Regex."""
    return isinstance(value, str) and _STATION_CODE.fullmatch(value.strip()) is not None


def validate_report_id(value: str) -> bool:
    """Accept report identifiers such as ``MR-20260101``."""
    return isinstance(value, str) and _REPORT_ID.fullmatch(value.strip().upper()) is not None
