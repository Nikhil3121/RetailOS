"""Inventory: append-only stock ledger + a per-(store, variant) balance cache.

The ledger is the source of truth. `StockBalance` is a projection kept in sync
inside the same transaction as each ledger insert — this gives us O(1) balance
lookups while remaining fully reconstructable from history.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from enum import Enum

from typing import Any

from sqlalchemy import ForeignKey, JSON, Numeric, String, TypeDecorator, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin
from app.db.models.product import ProductVariant
from app.db.models.store import Store


class MovementKind(str, Enum):
    """Why a stock row exists. Extensible without a migration — column is VARCHAR."""

    PURCHASE_RECEIPT = "purchase_receipt"
    SALE = "sale"
    SALE_RETURN = "sale_return"
    PURCHASE_RETURN = "purchase_return"
    ADJUSTMENT = "adjustment"
    TRANSFER_OUT = "transfer_out"
    TRANSFER_IN = "transfer_in"
    OPENING_BALANCE = "opening_balance"


class _MovementKindType(TypeDecorator):
    """Persist MovementKind as VARCHAR, hydrate back into the enum on load."""

    impl = String(32)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, MovementKind):
            return value.value
        return MovementKind(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        return MovementKind(value)


class StockMovement(UUIDPKMixin, TimestampMixin, Base):
    """A single, immutable stock change. Positive delta = stock in, negative = out.

    The pair (reference_type, reference_id) points at the domain event that caused
    the movement (a GRN, a sale invoice, an adjustment note) — the ledger stays
    auditable even if those upstream rows are later archived.
    """

    __tablename__ = "stock_movements"

    variant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("product_variants.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stores.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    kind: Mapped[MovementKind] = mapped_column(_MovementKindType(), nullable=False, index=True)

    # Signed delta and a snapshot of the balance after this row was posted.
    # Balance snapshot avoids expensive SUM() queries when reconstructing history.
    delta: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)

    # Per-unit cost associated with this movement (feeds weighted-average /
    # FIFO cost accounting). Optional — manual adjustments may not carry a cost.
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    reference_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reference_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Raw row from legacy import (see migration 0014).
    source_data: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB().with_variant(JSON(), "sqlite"), nullable=True
    )

    variant: Mapped[ProductVariant] = relationship("ProductVariant")
    store: Mapped[Store] = relationship("Store")


class StockBalance(UUIDPKMixin, TimestampMixin, Base):
    """Cached current quantity per (variant, store). Rebuildable from the ledger."""

    __tablename__ = "stock_balances"
    __table_args__ = (
        UniqueConstraint("variant_id", "store_id", name="uq_stock_balances_variant_store"),
    )

    variant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("product_variants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stores.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    quantity: Mapped[Decimal] = mapped_column(
        Numeric(14, 3), nullable=False, default=Decimal("0.000")
    )

    variant: Mapped[ProductVariant] = relationship("ProductVariant")
    store: Mapped[Store] = relationship("Store")
