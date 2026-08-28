"""Expense categories + expense records with an approval workflow.

State machine:

    DRAFT ─── submit ──▶ SUBMITTED ─── approve ──▶ APPROVED  (counts in P&L)
       │                     │
       │                     └── reject ──▶ REJECTED ─── edit ──▶ DRAFT
       │
       └── delete (creator only, before submit)

Only DRAFT + REJECTED are editable. Only APPROVED contributes to reports.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Numeric,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin, UtcDateTime

if TYPE_CHECKING:
    from app.db.models.store import Store


class ExpenseStatus(str, Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"


class _ExpenseStatusType(TypeDecorator):
    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, ExpenseStatus):
            return value.value
        return ExpenseStatus(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        return None if value is None else ExpenseStatus(value)


class ExpenseCategory(UUIDPKMixin, TimestampMixin, Base):
    """Bucket every expense goes into — rent, utilities, marketing, etc."""

    __tablename__ = "expense_categories"
    __table_args__ = (
        UniqueConstraint("code", name="uq_expense_categories_code"),
    )

    code: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Expense(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "expenses"
    __table_args__ = (UniqueConstraint("number", name="uq_expenses_number"),)

    number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)

    category_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("expense_categories.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # Nullable — some expenses (org-wide software, HQ rent) don't belong to a store.
    store_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stores.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    status: Mapped[ExpenseStatus] = mapped_column(
        _ExpenseStatusType(),
        nullable=False,
        default=ExpenseStatus.DRAFT,
        index=True,
    )

    expense_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )

    # Free-form: cash / card / upi / bank_transfer / cheque / other.
    # Kept as a string (not an enum) so extensions like "petty_cash" don't need a schema change.
    payment_method: Mapped[str] = mapped_column(String(32), nullable=False, default="cash")
    vendor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(128), nullable=True)
    receipt_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    submitted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    submitted_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)

    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)

    rejected_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    category: Mapped[ExpenseCategory] = relationship("ExpenseCategory")
    store: Mapped["Store | None"] = relationship("Store")

    @property
    def grand_total(self) -> Decimal:
        return (self.amount or Decimal("0.00")) + (self.tax_amount or Decimal("0.00"))
