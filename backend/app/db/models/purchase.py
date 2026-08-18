"""Purchase orders. A PO moves through DRAFT → CONFIRMED → RECEIVED.

Only DRAFT is editable. Confirming freezes totals. Receiving posts stock
movements atomically and locks the PO from further edits.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import (
    Date,
    DateTime,
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
    from app.db.models.product import ProductVariant
    from app.db.models.store import Store
    from app.db.models.supplier import Supplier


class PurchaseOrderStatus(str, Enum):
    DRAFT = "draft"
    CONFIRMED = "confirmed"
    RECEIVED = "received"
    CANCELLED = "cancelled"


class _POStatusType(TypeDecorator):
    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, PurchaseOrderStatus):
            return value.value
        return PurchaseOrderStatus(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        return PurchaseOrderStatus(value)


class PurchaseOrder(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "purchase_orders"
    __table_args__ = (UniqueConstraint("number", name="uq_purchase_orders_number"),)

    # Human-facing identifier: PO-YYYYMMDD-XXXXXX. Assigned on create.
    number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)

    supplier_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("suppliers.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stores.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    status: Mapped[PurchaseOrderStatus] = mapped_column(
        _POStatusType(),
        nullable=False,
        default=PurchaseOrderStatus.DRAFT,
        index=True,
    )

    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    expected_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)

    # Cached totals in the order's currency. Recomputed on any line change while DRAFT.
    subtotal: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    tax_total: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    grand_total: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    supplier: Mapped["Supplier"] = relationship("Supplier", back_populates="purchase_orders")
    store: Mapped["Store"] = relationship("Store")
    lines: Mapped[list["PurchaseOrderLine"]] = relationship(
        "PurchaseOrderLine",
        back_populates="purchase_order",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PurchaseOrderLine.sort_order",
    )


class PurchaseOrderLine(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "purchase_order_lines"

    purchase_order_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("purchase_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("product_variants.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    tax_rate: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0.00")
    )
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)

    sort_order: Mapped[int] = mapped_column(nullable=False, default=0)

    purchase_order: Mapped["PurchaseOrder"] = relationship(
        "PurchaseOrder", back_populates="lines"
    )
    variant: Mapped["ProductVariant"] = relationship("ProductVariant")
