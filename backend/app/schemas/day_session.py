"""Day-session DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.db.models.day_session import DayStatus
from app.schemas.common import ORMModel


class OpenSessionRequest(BaseModel):
    store_id: uuid.UUID
    opening_cash: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2, max_digits=14)
    notes: str | None = None


class CloseSessionRequest(BaseModel):
    counted_cash: Decimal = Field(ge=0, decimal_places=2, max_digits=14)
    #: The drawer as notes counted, e.g. {"500": 6, "100": 11}.
    #:
    #: Optional. When given, the server DERIVES the total from it and refuses a
    #: `counted_cash` that disagrees — a fat-fingered digit in a typed total is
    #: otherwise indistinguishable from a genuinely short drawer, and the shop
    #: finds out the next morning when nobody remembers what was in the till.
    #:
    #: Keys are denomination values as strings; the set is deliberately open,
    #: because Indian currency has been redenominated twice in living memory.
    denominations: dict[str, int] | None = Field(
        default=None,
        description='Notes counted, e.g. {"500": 6, "100": 11}.',
    )
    notes: str | None = None

    @field_validator("denominations")
    @classmethod
    def _sane_denominations(cls, v: dict[str, int] | None) -> dict[str, int] | None:
        """Reject nonsense before it becomes a cash figure.

        A negative count of notes is not a shortage, it is a bug, and letting
        one through would silently reduce a drawer total that somebody will
        later be held responsible for.
        """
        if v is None:
            return v
        cleaned: dict[str, int] = {}
        for note, count in v.items():
            try:
                value = int(note)
            except (TypeError, ValueError):
                raise ValueError(f"{note!r} is not a note value.") from None
            if value <= 0:
                raise ValueError("A note must be worth more than nothing.")
            if not isinstance(count, int) or count < 0:
                raise ValueError(f"Count for {note} must be zero or more.")
            # Zero of a denomination carries no information and would clutter
            # every stored breakdown with the notes nobody had.
            if count:
                cleaned[str(value)] = count
        return cleaned or None


class DaySessionRead(ORMModel):
    id: uuid.UUID
    store_id: uuid.UUID
    status: DayStatus
    opened_by_user_id: uuid.UUID | None
    opened_at: datetime
    opening_cash: Decimal
    closed_by_user_id: uuid.UUID | None
    closed_at: datetime | None
    counted_cash: Decimal | None
    #: The breakdown behind `counted_cash`, when one was entered.
    cash_denominations: dict[str, int] | None = None
    expected_cash: Decimal | None
    cash_diff: Decimal | None
    # Set when a late-arriving offline sale restated this shift AFTER it was
    # closed. Read-only and purely informational: exposing it lets the UI say
    # that expected_cash and cash_diff are no longer the figures produced at
    # close, which otherwise looks like the numbers changed by themselves.
    # The full before/after detail lives in audit_logs (day_session.restated).
    restated_at: datetime | None = None
    notes: str | None
    created_at: datetime


class DaySessionSummary(BaseModel):
    """Rich payload for the day-close screen — includes sales totals."""

    session: DaySessionRead
    sales_count: int
    sales_total: Decimal
    cash_sales_total: Decimal
    card_sales_total: Decimal
    upi_sales_total: Decimal
    other_sales_total: Decimal
    expected_cash: Decimal
