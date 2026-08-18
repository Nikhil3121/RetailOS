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
