"""Sale (invoice) + lines + payments + invoice-number sequence.

Every ring-up creates one Sale row with N SaleLine rows and >=1 SalePayment rows.
Line-level fields snapshot product name/SKU/HSN/tax at sale time so historical
invoices don't mutate when catalog data changes later.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import (
    ForeignKey,
    Integer,
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
    from app.db.models.customer import Customer
    from app.db.models.day_session import DaySession
    from app.db.models.product import ProductVariant
    from app.db.models.store import Store


# ---------------------------------------------------------------------------
# Enums + TypeDecorators
# ---------------------------------------------------------------------------


class SaleStatus(str, Enum):
    COMPLETED = "completed"
    VOIDED = "voided"


class PaymentMethod(str, Enum):
    CASH = "cash"
    CARD = "card"
    UPI = "upi"
    OTHER = "other"


class _SaleStatusType(TypeDecorator):
    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, SaleStatus):
            return value.value
        return SaleStatus(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        return SaleStatus(value)


class _PaymentMethodType(TypeDecorator):
    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, PaymentMethod):
            return value.value
        return PaymentMethod(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        return PaymentMethod(value)


# ---------------------------------------------------------------------------
# Invoice number sequence
# ---------------------------------------------------------------------------


class SaleNumberSequence(UUIDPKMixin, TimestampMixin, Base):
    """One counter per (store, YYYYMM). Bumped inside the sale-create transaction."""

    __tablename__ = "sale_number_sequences"
    __table_args__ = (
        UniqueConstraint("store_id", "year_month", name="uq_sale_number_sequences_store_month"),
    )

    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stores.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    year_month: Mapped[str] = mapped_column(String(6), nullable=False, index=True)  # e.g. "202607"
    next_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


# ---------------------------------------------------------------------------
# Sale + lines + payments
# ---------------------------------------------------------------------------


class Sale(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "sales"
    __table_args__ = (
        UniqueConstraint("number", name="uq_sales_number"),
        UniqueConstraint("client_uuid", name="uq_sales_client_uuid"),
    )

    number: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    # Client-generated idempotency key. When the frontend queues a bill during
    # an internet drop, the same UUID rides every retry — if a row with this
    # UUID already exists, the service returns the existing sale instead of
    # ringing it up twice. NULL for legacy / non-offline flows.
    client_uuid: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # ---- offline attribution (Phase 5E) ------------------------------------
    # When the sale ACTUALLY happened. Set from the terminal for an offline
    # bill, and to server now() for an online one, so it is always populated
    # and always means the same thing. Never overwritten after creation - it
    # is the primary audit fact and drives the invoice month.
    occurred_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)
    # Which till rang the sale. Carries the terminal's device_uuid. Deliberately
    # NOT a foreign key: no server-side terminal registry exists yet, and a sale
    # must not be rejected because a till has not been provisioned. NULL on
    # every sale written before this phase.
    terminal_uuid: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stores.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    day_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("day_sessions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    status: Mapped[SaleStatus] = mapped_column(
        _SaleStatusType(), nullable=False, default=SaleStatus.COMPLETED, index=True
    )

    # Financials — every column recomputed on create from line inputs.
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    discount_total: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    tax_total: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    grand_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    paid_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    change_due: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    # Outstanding amount the customer still owes on this bill. Zero for a fully
    # paid sale, positive when the bill was rung up on credit (partial or full
    # "due"). Recomputed every time a SalePayment is added or removed.
    balance_due: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00"), index=True
    )

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    completed_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)
    voided_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)
    void_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # The staff member credited with the *sale* (not the cashier who rang it
    # up). Nullable — legacy bills and cashier-only setups leave it blank; the
    # commission + staff-performance rollups then fall back to created_by_user_id.
    salesperson_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    lines: Mapped[list["SaleLine"]] = relationship(
        "SaleLine",
        back_populates="sale",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="SaleLine.sort_order",
    )
    payments: Mapped[list["SalePayment"]] = relationship(
        "SalePayment",
        back_populates="sale",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    customer: Mapped["Customer | None"] = relationship("Customer")
    store: Mapped["Store"] = relationship("Store")
    day_session: Mapped["DaySession"] = relationship("DaySession")


class SaleLine(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "sale_lines"

    sale_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sales.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("product_variants.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # Snapshots so historical invoices don't shift when catalog data changes.
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    variant_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    hsn_code: Mapped[str | None] = mapped_column(String(16), nullable=True)

    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Percentage discount off the line (0..100).
    discount_pct: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0.00")
    )
    discount_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    tax_rate: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0.00")
    )
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)

    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    sale: Mapped["Sale"] = relationship("Sale", back_populates="lines")
    variant: Mapped["ProductVariant"] = relationship("ProductVariant")


class SalePayment(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "sale_payments"

    sale_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sales.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    method: Mapped[PaymentMethod] = mapped_column(_PaymentMethodType(), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(128), nullable=True)

    sale: Mapped["Sale"] = relationship("Sale", back_populates="payments")
