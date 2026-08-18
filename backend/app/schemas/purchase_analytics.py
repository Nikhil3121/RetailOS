"""Purchase-analytics DTOs — supplier + purchase trend rollups."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class SupplierScorecard(BaseModel):
    supplier_id: uuid.UUID
    supplier_name: str
    supplier_code: str
    po_count: int
    total_spend: Decimal
    completed_pos: int
    cancelled_pos: int
    avg_turnaround_days: Decimal | None = Field(
        default=None,
        description="Mean days between order_date and received_at across received POs.",
    )
    last_order_at: date | None


class PurchaseTrendPoint(BaseModel):
    day: date
    po_count: int
    total_spend: Decimal


class PurchaseCostRow(BaseModel):
    variant_id: uuid.UUID
    sku: str
    product_name: str
    total_units_ordered: Decimal
    total_units_received: Decimal
    total_cost: Decimal
    average_unit_cost: Decimal


class PurchaseAnalyticsSummary(BaseModel):
    from_date: date
    to_date: date
    po_count: int
    total_spend: Decimal
    completed_spend: Decimal
    cancelled_spend: Decimal
    unique_suppliers: int
