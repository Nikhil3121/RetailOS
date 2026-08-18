"""Report DTOs — minimal summaries for the reports screen."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class SalesSummary(BaseModel):
    from_date: date
    to_date: date
    sales_count: int
    gross_total: Decimal
    tax_total: Decimal
    discount_total: Decimal
    net_total: Decimal
    cash_total: Decimal
    card_total: Decimal
    upi_total: Decimal
    other_total: Decimal


class TopProductRow(BaseModel):
    variant_id: uuid.UUID
    sku: str
    product_name: str
    quantity_sold: Decimal
    revenue: Decimal


class DailySalesRow(BaseModel):
    day: date
    sales_count: int
    gross_total: Decimal
