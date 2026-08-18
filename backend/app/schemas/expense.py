"""Expense DTOs — categories + expense records + report shapes."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, HttpUrl

from app.db.models.expense import ExpenseStatus
from app.schemas.common import ORMModel

_ZERO = Decimal("0.00")


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


class ExpenseCategoryBase(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None
    is_active: bool = True


class ExpenseCategoryCreate(ExpenseCategoryBase):
    pass


class ExpenseCategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    is_active: bool | None = None


class ExpenseCategoryRead(ORMModel):
    id: uuid.UUID
    code: str
    name: str
    description: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------


class ExpenseBase(BaseModel):
    category_id: uuid.UUID
    store_id: uuid.UUID | None = None
    expense_date: date
    amount: Decimal = Field(gt=0, decimal_places=2, max_digits=14)
    tax_amount: Decimal = Field(default=_ZERO, ge=0, decimal_places=2, max_digits=14)
    payment_method: str = Field(default="cash", min_length=1, max_length=32)
    vendor: str | None = Field(default=None, max_length=255)
    reference: str | None = Field(default=None, max_length=128)
    receipt_url: HttpUrl | None = None
    notes: str | None = None


class ExpenseCreate(ExpenseBase):
    submit: bool = Field(
        default=False,
        description="If true, transitions the new expense from DRAFT to SUBMITTED atomically.",
    )


class ExpenseUpdate(BaseModel):
    """Only usable while status is DRAFT or REJECTED."""

    category_id: uuid.UUID | None = None
    store_id: uuid.UUID | None = None
    expense_date: date | None = None
    amount: Decimal | None = Field(default=None, gt=0, decimal_places=2, max_digits=14)
    tax_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2, max_digits=14)
    payment_method: str | None = Field(default=None, min_length=1, max_length=32)
    vendor: str | None = None
    reference: str | None = None
    receipt_url: HttpUrl | None = None
    notes: str | None = None


class ExpenseRejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=255)


class ExpenseRead(ORMModel):
    id: uuid.UUID
    number: str
    category_id: uuid.UUID
    store_id: uuid.UUID | None
    status: ExpenseStatus
    expense_date: date
    amount: Decimal
    tax_amount: Decimal
    grand_total: Decimal
    payment_method: str
    vendor: str | None
    reference: str | None
    receipt_url: str | None
    notes: str | None
    submitted_by_user_id: uuid.UUID | None
    submitted_at: datetime | None
    approved_by_user_id: uuid.UUID | None
    approved_at: datetime | None
    rejected_at: datetime | None
    reject_reason: str | None
    created_by_user_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Reports (P&L integration)
# ---------------------------------------------------------------------------


class ExpenseByCategoryRow(BaseModel):
    category_id: uuid.UUID
    category_code: str
    category_name: str
    approved_count: int
    approved_total: Decimal


class ExpenseTrendPoint(BaseModel):
    day: date
    approved_count: int
    approved_total: Decimal


class ExpenseSummary(BaseModel):
    from_date: date
    to_date: date
    store_id: uuid.UUID | None
    draft_count: int
    submitted_count: int
    approved_count: int
    rejected_count: int
    submitted_pending_total: Decimal
    approved_total: Decimal


class PnLReport(BaseModel):
    from_date: date
    to_date: date
    store_id: uuid.UUID | None
    revenue: Decimal
    discounts: Decimal
    tax_collected: Decimal
    net_revenue: Decimal
    cost_of_goods_sold: Decimal
    gross_profit: Decimal
    operating_expenses: Decimal
    net_profit: Decimal
    net_margin_pct: Decimal | None
