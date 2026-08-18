"""Customer timeline — a mixed feed of sales and coupon redemptions ordered by
time. Frontend renders one row per entry, styled by kind.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field


class TimelineKind(str, Enum):
    SALE = "sale"
    SALE_VOIDED = "sale_voided"
    COUPON_REDEMPTION = "coupon_redemption"


class TimelineEntry(BaseModel):
    kind: TimelineKind
    at: datetime
    title: str
    subtitle: str | None = None
    amount: Decimal | None = None
    points: Decimal | None = None
    reference: str | None = None
    sale_id: uuid.UUID | None = None
    coupon_id: uuid.UUID | None = None


class TimelinePayload(BaseModel):
    customer_id: uuid.UUID
    entries: list[TimelineEntry] = Field(default_factory=list)
