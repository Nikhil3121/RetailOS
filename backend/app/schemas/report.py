"""Report DTOs — minimal summaries for the reports screen."""

from __future__ import annotations

import uuid
from datetime import date, datetime
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


# ---------------------------------------------------------------------------
# Sales broken down by a dimension
# ---------------------------------------------------------------------------


class SalesBreakdownRow(BaseModel):
    """One slice of the day's takings.

    Deliberately generic: brand, category, size and salesperson are the same
    question asked of four different columns, and four near-identical report
    endpoints would drift apart within a month.
    """

    #: The grouping value's id, when it has one. Null for a size, which is a
    #: variant name rather than a row in a table, and for the "unassigned"
    #: bucket every one of these dimensions has.
    key_id: uuid.UUID | None = None
    #: What to print. Never blank — an unlabelled row in a report is a row
    #: nobody can act on.
    label: str
    quantity_sold: Decimal
    revenue: Decimal
    #: Share of the period's revenue, 0–100. Computed server-side so the
    #: screen and any export agree to the paisa.
    share_pct: Decimal


class ItemProfitRow(BaseModel):
    variant_id: uuid.UUID
    sku: str
    product_name: str
    variant_name: str
    quantity_sold: Decimal
    revenue: Decimal
    #: Revenue minus the cost SNAPSHOTTED on each line. Null when no line in
    #: the period carried a cost — see `uncosted_lines` on the envelope.
    cost: Decimal | None
    profit: Decimal | None
    margin_pct: Decimal | None


class ItemProfitReport(BaseModel):
    """Item-wise profit, with the honesty about what it could not cost.

    Lines written before costs were snapshotted carry no cost, and there is no
    truthful way to invent one — today's cost price is not what those goods
    cost when they were sold. Rather than quietly excluding them or costing
    them at zero (which would report the entire sale as profit), the report
    counts them and says so.
    """

    from_date: date
    to_date: date
    rows: list[ItemProfitRow]
    total_revenue: Decimal
    total_cost: Decimal
    total_profit: Decimal
    #: Sale lines in the period with no cost recorded. When this is above zero
    #: the totals above cover only PART of the period's sales, and the screen
    #: must say so rather than presenting them as the whole picture.
    uncosted_lines: int
    #: Revenue sitting on those uncosted lines. This is the size of the hole.
    uncosted_revenue: Decimal


# ---------------------------------------------------------------------------
# Day book
# ---------------------------------------------------------------------------


class DayBookEntry(BaseModel):
    """One money movement, in the order it happened."""

    at: datetime
    #: sale | return | collection | expense
    kind: str
    reference: str
    party: str | None
    #: How it was paid. Null for a credit sale, which moved goods and no money.
    method: str | None
    #: Signed. Money IN is positive, money OUT is negative — a day book that
    #: reported both as positive would need a legend to be read at all.
    amount: Decimal


class DayBook(BaseModel):
    """Everything that moved money on one day, at one branch.

    The report a shop owner actually opens at closing time: not "what did we
    sell" but "what should be in the drawer, and does it match".

    Cash is tracked separately from the total throughout, because the drawer
    only ever holds cash. A day of card sales inflates takings and changes the
    drawer by nothing.
    """

    day: date
    store_id: uuid.UUID | None
    entries: list[DayBookEntry]
    #: Cash counted at the start of the shift. Null when no day session was
    #: opened — a real situation on a till that has never done a formal open,
    #: and different from "opened with zero".
    opening_cash: Decimal | None
    sales_total: Decimal
    returns_total: Decimal
    collections_total: Decimal
    expenses_total: Decimal
    #: Net across every method. What the business earned.
    net_total: Decimal
    #: Cash only. What the drawer should hold, before any counted figure.
    cash_in: Decimal
    cash_out: Decimal
    expected_cash: Decimal | None
