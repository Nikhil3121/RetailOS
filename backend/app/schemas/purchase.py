"""Purchase-order DTOs."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.db.models.purchase import PurchaseOrderStatus
from app.schemas.common import ORMModel

_ZERO = Decimal("0.00")


class POLineBase(BaseModel):
    variant_id: uuid.UUID
    quantity: Decimal = Field(gt=0, decimal_places=3, max_digits=14)
    unit_cost: Decimal = Field(ge=0, decimal_places=2, max_digits=12)
    tax_rate: Decimal = Field(default=_ZERO, ge=0, le=100, decimal_places=2, max_digits=5)


class POLineCreate(POLineBase):
    pass


class POLineRead(ORMModel):
    id: uuid.UUID
    purchase_order_id: uuid.UUID
    variant_id: uuid.UUID
    quantity: Decimal
    unit_cost: Decimal
    tax_rate: Decimal
    subtotal: Decimal
    tax_amount: Decimal
    line_total: Decimal
    sort_order: int


class PurchaseOrderCreate(BaseModel):
    supplier_id: uuid.UUID
    store_id: uuid.UUID
    order_date: date
    expected_date: date | None = None
    notes: str | None = None
    lines: list[POLineCreate] = Field(min_length=1)


class PurchaseOrderUpdate(BaseModel):
    """Only meaningful while status == DRAFT."""

    supplier_id: uuid.UUID | None = None
    expected_date: date | None = None
    notes: str | None = None
    lines: list[POLineCreate] | None = Field(
        default=None,
        description="If provided, replaces the whole line set.",
    )


class PurchaseOrderRead(ORMModel):
    id: uuid.UUID
    number: str
    supplier_id: uuid.UUID
    store_id: uuid.UUID
    status: PurchaseOrderStatus
    order_date: date
    expected_date: date | None
    received_at: datetime | None
    subtotal: Decimal
    tax_total: Decimal
    grand_total: Decimal
    notes: str | None
    lines: list[POLineRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class PurchaseOrderSummary(ORMModel):
    id: uuid.UUID
    number: str
    supplier_id: uuid.UUID
    store_id: uuid.UUID
    status: PurchaseOrderStatus
    order_date: date
    expected_date: date | None
    grand_total: Decimal
    line_count: int
    created_at: datetime


class LastPurchaseRate(BaseModel):
    """What this item cost last time, and from whom.

    THE QUESTION THIS ANSWERS
    A buyer raising a purchase order is deciding whether the rate in front of
    them is reasonable. Without the last one they are guessing, or ringing the
    shop to ask, or — most often — accepting whatever the supplier quoted.
    A rate that crept up 8% between orders is invisible until somebody puts the
    two numbers next to each other.

    THE DATE IS NOT DECORATION
    A rate from two years ago is not a comparison, it is a trap: the buyer sees
    a figure, reads it as current, and challenges a supplier over inflation
    that already happened. So the date and the supplier travel with it, and the
    screen shows them.
    """

    variant_id: uuid.UUID
    unit_cost: Decimal
    #: Which purchase order it came from, so the buyer can open it.
    purchase_order_id: uuid.UUID
    purchase_order_number: str
    supplier_id: uuid.UUID
    supplier_name: str
    order_date: date
    #: True when the rate came from a DIFFERENT supplier than the one being
    #: ordered from now. A cheaper rate elsewhere is worth knowing; a cheaper
    #: rate from the same supplier is a negotiating position.
    from_other_supplier: bool = False
