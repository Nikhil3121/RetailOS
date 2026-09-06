"""What "today" means to the shop.

Every timestamp in this database is stored in UTC, and that is right: UTC is
the only clock that does not move under you. But a shop's DAY is not a UTC day,
and several decisions turn on the calendar date a PERSON would name:

  · a gift scheme "valid to 15 November" must run on the 15th as the shopkeeper
    counts it — not from 05:30 that morning, which is when 15 November begins
    in UTC and is several hours into the busiest day of a festival;
  · a day book asked for "today" means today in the shop, not today in
    Greenwich.

This module is the single place that conversion happens, so the answer cannot
drift between one report and another.

DEFAULT IS UTC, ON PURPOSE
Changing what "today" means changes reported figures, so it is an explicit
decision made by whoever runs the deployment (`BUSINESS_TIMEZONE`), not
something that happens silently because a server moved region.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.config import get_settings


def business_tz() -> timezone | ZoneInfo:
    """The shop's timezone, or UTC if the configured name is not known.

    Falls back rather than raising. A typo in an environment variable must not
    be able to take a till offline, and UTC is the behaviour the system had
    before this setting existed — so the failure mode is "unchanged", not
    "broken".
    """
    name = (get_settings().business_timezone or "UTC").strip()
    if not name or name.upper() == "UTC":
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return timezone.utc


def business_date(moment: datetime | None = None) -> date:
    """The calendar date a person in the shop would call this moment.

    A naive datetime is read as UTC, because that is what everything in this
    database is; guessing the server's local zone for it would make the answer
    depend on where the process happens to be running.
    """
    if moment is None:
        moment = datetime.now(timezone.utc)
    elif moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(business_tz()).date()
