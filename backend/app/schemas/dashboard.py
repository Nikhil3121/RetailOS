"""BI dashboard DTOs.

The dashboard endpoint returns one composite payload so the front-end renders
in a single round-trip instead of orchestrating 8 parallel queries. Each nested
block is small and can also be requested individually via dedicated report
endpoints — dashboards are just the biggest consumer.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field


class Period(str, Enum):
    TODAY = "today"
    YESTERDAY = "yesterday"
    WEEK = "week"        # last 7 days including today
    MONTH = "month"      # last 30 days
    YEAR = "year"        # last 365 days


class KPIWithDelta(BaseModel):
    """Absolute value plus signed delta vs the prior period of equal length."""

    current: Decimal
    previous: Decimal
    delta_absolute: Decimal
    delta_pct: Decimal | None = Field(
        default=None,
        description="None when previous == 0 (division undefined).",
    )


class DashboardKPIs(BaseModel):
    revenue: KPIWithDelta
    tax_collected: KPIWithDelta
    discounts_given: KPIWithDelta
    net_revenue: KPIWithDelta
    sales_count: KPIWithDelta
    average_order_value: KPIWithDelta
    unique_customers: KPIWithDelta
    estimated_profit: KPIWithDelta
    estimated_margin_pct: KPIWithDelta


class HourlyBucket(BaseModel):
    hour: int = Field(ge=0, le=23)
    sales_count: int
    gross_total: Decimal


class StoreComparisonRow(BaseModel):
    store_id: uuid.UUID
    store_code: str
    store_name: str
    sales_count: int
    gross_total: Decimal
    tax_total: Decimal
    average_order_value: Decimal


class ProductProfitRow(BaseModel):
    variant_id: uuid.UUID
    sku: str
    product_name: str
    quantity_sold: Decimal
    revenue: Decimal
    estimated_cost: Decimal
    estimated_profit: Decimal
    estimated_margin_pct: Decimal | None


class PaymentMix(BaseModel):
    cash: Decimal
    card: Decimal
    upi: Decimal
    other: Decimal


class DashboardPayload(BaseModel):
    """Everything the BI dashboard needs in one shot."""

    period: Period
    from_date: date
    to_date: date
    previous_from: date
    previous_to: date
    store_id: uuid.UUID | None
    kpis: DashboardKPIs
    hourly: list[HourlyBucket]
    daily_trend: list["DailyPoint"]
    payment_mix: PaymentMix
    top_products: list[ProductProfitRow]
    store_comparison: list[StoreComparisonRow]


class DailyPoint(BaseModel):
    day: date
    sales_count: int
    gross_total: Decimal


DashboardPayload.model_rebuild()
