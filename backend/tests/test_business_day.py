"""What "today" means to the shop.

Every timestamp is stored in UTC, which is right. But several decisions turn
on the calendar date a PERSON would name, and getting that wrong is not
cosmetic: a gift scheme dated "15 November" that does not fire until 05:30
that morning has missed the busiest hours of a festival.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from app.core.business_day import business_date, business_tz
from app.core.config import get_settings


def _with_tz(name: str):
    """Set BUSINESS_TIMEZONE and clear the memoised settings."""
    import os

    previous = os.environ.get("BUSINESS_TIMEZONE")
    os.environ["BUSINESS_TIMEZONE"] = name
    get_settings.cache_clear()
    return previous


def _restore(previous: str | None) -> None:
    import os

    if previous is None:
        os.environ.pop("BUSINESS_TIMEZONE", None)
    else:
        os.environ["BUSINESS_TIMEZONE"] = previous
    get_settings.cache_clear()


def test_the_default_is_utc_and_changes_nothing() -> None:
    """Changing what "today" means changes reported figures. It has to be an
    explicit decision, not something that happens because a server moved."""
    prev = _with_tz("UTC")
    try:
        moment = datetime(2026, 11, 15, 2, 0, tzinfo=timezone.utc)
        assert business_date(moment) == date(2026, 11, 15)
    finally:
        _restore(prev)


def test_the_shops_day_rolls_over_before_utcs() -> None:
    """THE CASE THAT MATTERS.

    02:00 UTC on 15 November is 07:30 IST on the 15th — the shop is open and
    it is the festival. Read as UTC that is the 15th too, so this one agrees;
    the disagreement is in the other direction, below.
    """
    prev = _with_tz("Asia/Kolkata")
    try:
        # 20:00 UTC on the 14th is already 01:30 on the 15th in the shop.
        moment = datetime(2026, 11, 14, 20, 0, tzinfo=timezone.utc)
        assert business_date(moment) == date(2026, 11, 15)
        # And 00:30 UTC on the 15th is still 06:00 on the 15th in the shop.
        assert business_date(datetime(2026, 11, 15, 0, 30, tzinfo=timezone.utc)) == date(
            2026, 11, 15
        )
    finally:
        _restore(prev)


def test_a_naive_timestamp_is_read_as_utc() -> None:
    """Everything in this database is UTC. Guessing the server's local zone
    would make the answer depend on where the process is running."""
    prev = _with_tz("Asia/Kolkata")
    try:
        assert business_date(datetime(2026, 11, 14, 20, 0)) == date(2026, 11, 15)
    finally:
        _restore(prev)


def test_an_unknown_zone_falls_back_to_utc_rather_than_failing() -> None:
    """A typo in an environment variable must not be able to take a till
    offline. UTC is what the system did before this setting existed, so the
    failure mode is "unchanged", not "broken"."""
    prev = _with_tz("Mars/Olympus_Mons")
    try:
        assert business_tz() is timezone.utc
        moment = datetime(2026, 11, 14, 20, 0, tzinfo=timezone.utc)
        assert business_date(moment) == date(2026, 11, 14)
    finally:
        _restore(prev)


def test_an_empty_setting_is_utc() -> None:
    prev = _with_tz("")
    try:
        assert business_tz() is timezone.utc
    finally:
        _restore(prev)
