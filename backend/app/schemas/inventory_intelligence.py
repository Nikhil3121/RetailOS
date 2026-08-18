"""Inventory-intelligence DTOs.

Every row here is a projection over `stock_balances` × `product_variants` ×
`sale_lines`, computed live — there's no materialised cache. If volumes ever
outpace comfort, wrap the reads in a Redis-cached rollup.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field


class StockCategory(str, Enum):
    OUT_OF_STOCK = "out_of_stock"
    LOW = "low"
    HEALTHY = "healthy"
    OVERSTOCK = "overstock"


class MovementCategory(str, Enum):
    FAST = "fast"
    SLOW = "slow"
    DEAD = "dead"
    NORMAL = "normal"


# ---------------------------------------------------------------------------
# Per-variant rows
# ---------------------------------------------------------------------------


class StockAlertRow(BaseModel):
    variant_id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    sku: str
    barcode: str | None
    store_id: uuid.UUID
    store_code: str
    quantity: Decimal
    reorder_point: Decimal
    reorder_quantity: Decimal
    overstock_point: Decimal | None
    category: StockCategory
    days_of_cover: Decimal | None = Field(
        default=None,
        description="Estimated days of stock at current sales velocity. None if no sales in window.",
    )
    suggested_reorder_qty: Decimal | None = Field(
        default=None,
        description="Quantity to buy to hit reorder_point + reorder_quantity buffer. Only for LOW/OUT rows.",
    )


class MovementRow(BaseModel):
    variant_id: uuid.UUID
    sku: str
    product_name: str
    on_hand: Decimal
    sold_last_window: Decimal
    velocity_per_day: Decimal
    last_sale_at: date | None
    category: MovementCategory


class InventoryValueRow(BaseModel):
    store_id: uuid.UUID
    store_code: str
    store_name: str
    line_count: int
    on_hand_units: Decimal
    inventory_value: Decimal
    at_cost: bool = True


class InventoryValueTotal(BaseModel):
    line_count: int
    on_hand_units: Decimal
    inventory_value: Decimal
    per_store: list[InventoryValueRow]


class InventoryAgingRow(BaseModel):
    """How long has this stock been sitting? Bucketed by days since last inbound movement."""

    variant_id: uuid.UUID
    sku: str
    product_name: str
    store_id: uuid.UUID
    store_code: str
    quantity: Decimal
    last_inbound_at: date | None
    days_since_inbound: int | None
    bucket: str  # "0-30", "31-60", "61-90", "90+"


class InventoryHealthSummary(BaseModel):
    """Landing-page counters for the health dashboard."""

    total_skus_in_stock: int
    out_of_stock_count: int
    low_stock_count: int
    overstock_count: int
    dead_stock_count: int
    fast_movers_count: int
    slow_movers_count: int
    total_inventory_value: Decimal
