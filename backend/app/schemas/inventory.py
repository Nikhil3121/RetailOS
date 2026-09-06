"""Inventory DTOs — balances and stock movements."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.db.models.inventory import MovementKind
from app.schemas.common import ORMModel


class StockBalanceRead(ORMModel):
    id: uuid.UUID
    variant_id: uuid.UUID
    store_id: uuid.UUID
    quantity: Decimal


class StockLevelRow(BaseModel):
    """List-view row combining balance with variant + product context.

    Emitted by `GET /inventory/levels`. When the underlying (variant, store) has
    never been touched there is no `StockBalance` row — the join still returns
    the variant with `quantity = 0`, so brand-new products appear in the grid
    and can be received-into directly instead of having to be "adjusted from"
    an implicit zero.
    """

    variant_id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    variant_name: str
    sku: str
    barcode: str | None
    store_id: uuid.UUID
    store_code: str
    quantity: Decimal
    # What it sells for. Carried on the row so a screen that lets someone pick
    # an item from this grid — the exchange counter, a stock count — can price
    # it without a second request per item. Display only: every write path
    # prices the item itself.
    selling_price: Decimal
    # Unit + reorder metadata so the UI can render "12 kg", "Low stock" chips,
    # etc. without a second round-trip per row.
    unit_symbol: str
    unit_is_fractional: bool
    reorder_point: Decimal
    is_active: bool


class StockMovementRead(ORMModel):
    id: uuid.UUID
    variant_id: uuid.UUID
    store_id: uuid.UUID
    kind: MovementKind
    delta: Decimal
    balance_after: Decimal
    unit_cost: Decimal | None
    reference_type: str | None
    reference_id: uuid.UUID | None
    reason: str | None
    created_by_user_id: uuid.UUID | None
    created_at: datetime


class StockAdjustmentLine(BaseModel):
    variant_id: uuid.UUID
    delta: Decimal = Field(
        description="Signed change. Positive = stock in, negative = stock out.",
        decimal_places=3,
        max_digits=14,
    )
    unit_cost: Decimal | None = Field(default=None, ge=0, decimal_places=2, max_digits=12)


class StockAdjustmentRequest(BaseModel):
    store_id: uuid.UUID
    reason: str = Field(min_length=1, max_length=255)
    lines: list[StockAdjustmentLine] = Field(min_length=1)


class StockTransferRequest(BaseModel):
    from_store_id: uuid.UUID
    to_store_id: uuid.UUID
    reason: str | None = Field(default=None, max_length=255)
    lines: list[StockAdjustmentLine] = Field(
        min_length=1,
        description="Positive deltas only — one line per variant to transfer.",
    )
