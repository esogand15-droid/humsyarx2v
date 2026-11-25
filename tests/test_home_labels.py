"""Home/profile labels: raw intake codes and Gregorian expiry never reach the UI."""
import asyncio
from unittest.mock import AsyncMock, patch

from backend.api.routers import profile, subscription


class _Intakes:
    def __init__(self, row=None):
        self.find_one = AsyncMock(return_value=row)


def _label(code, row=None):
    with patch.object(profile.db, "intakes", _Intakes(row)):
        return asyncio.run(profile._intake_label(code))


def test_intake_label_prefers_admin_label():
    assert _label("bahman_1404", {"label": "بهمن ۱۴۰۴ (ترم یک)"}) == "بهمن ۱۴۰۴ (ترم یک)"


def test_intake_label_derives_persian_from_code():
    assert _label("bahman_1404") == "بهمن ۱۴۰۴"
    assert _label("mehr_1403") == "مهر ۱۴۰۳"


def test_intake_label_hides_unknown_codes():
    assert _label("weird_code") == ""
    assert _label("") == ""
    assert _label("1401") == "1401"


def test_expires_fa_is_jalali():
    out = subscription._expires_fa({"end_date": "2029-11-13T10:00:00+00:00"})
    assert "۱۴۰۸" in out and "2029" not in out
    assert subscription._expires_fa(None) == ""
    assert subscription._expires_fa({"end_date": ""}) == ""
