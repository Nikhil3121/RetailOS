"""Day-session DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.db.models.day_session import DayStatus
from app.schemas.common import ORMModel


class OpenSessionRequest(BaseModel):
    store_id: uuid.UUID
    opening_cash: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2, max_digits=14)
    notes: str | None = None


class CloseSessionRequest(BaseModel):
    counted_cash: Decimal = Field(ge=0, decimal_places=2, max_digits=14)
    notes: str | None = None


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
    expected_cash: Decimal | None
    cash_diff: Decimal | None
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
