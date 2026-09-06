"""Physical stock audit — counting what is actually on the shelf.

WHY THIS EXISTS
The legacy import deliberately brought over products and variants but NOT
stock, because the old system's quantities could not be trusted. Every variant
therefore starts at zero, and the only honest way to establish an opening
balance is for someone to walk the floor with a sheet and count. Until that
happens the shop cannot use stock figures for anything — not reordering, not
valuation, not "do we have this in medium".

It is not a one-off either. A garment shop re-counts a section at a time,
continuously, because shrinkage is real and a count that takes the whole shop
offline for a day never gets done twice.

THE DECISION THAT MATTERS: WHAT A COUNT POSTS
-------------------------------------------
A count sheet is filled in at 6pm and posted at 9pm. Three hours of sales
happen in between. There are two things the software could do with a line that
says "counted 5":

  SET the balance to 5.  Wrong. It silently re-adds the units sold after the
  count, because it treats the 9pm balance as if it were the 6pm one. The
  shop's stock is then overstated by exactly the evening's sales, and nothing
  in the ledger says so.

  Post the VARIANCE (counted − what the system said AT COUNT TIME).  Right.
  The correction is the discrepancy the counter actually found, and any real
  movement since is preserved on top of it.

So `system_qty` is snapshotted onto the line when the count is entered, and
posting applies `counted_qty − system_qty` as a delta. `StockCountLine.variance`
is that figure, computed once and stored, not re-derived at post time from a
balance that has since moved.

A LINE THAT IS NOT COUNTED IS NOT ZERO
--------------------------------------
Only lines present in the count are posted. A partial count of the saree
section must never zero the shirts — "we did not look at it" and "there are
none" are completely different facts, and conflating them writes off the
shop's entire inventory in one click.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Numeric,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from app.db.models.product import ProductVariant
    from app.db.models.store import Store


class StockCountStatus(str, Enum):
    """Where a count sheet is in its life.

    DRAFT is the only state that accepts edits, and POSTED is terminal — the
    ledger rows it wrote cannot be unwritten, so allowing a posted sheet back
    into DRAFT would let someone post the same variance twice.
    """

    DRAFT = "draft"
    POSTED = "posted"
    CANCELLED = "cancelled"


class _StatusType(TypeDecorator):
    """VARCHAR on the way in, enum on the way out. Matches MovementKind."""

    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, StockCountStatus):
            return value.value
        return StockCountStatus(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        return StockCountStatus(value)


class StockCount(UUIDPKMixin, TimestampMixin, Base):
    """One count sheet: a store, a scope, and the lines someone counted."""

    __tablename__ = "stock_counts"
    __table_args__ = (
        UniqueConstraint("store_id", "reference", name="uq_stock_counts_store_reference"),
    )

    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stores.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    #: Human handle for the sheet — "COUNT-2026-03-14-SAREES". Unique per store
    #: so two branches counting on the same day do not collide, and so a
    #: manager can say "pull up count 14" without knowing a UUID.
    reference: Mapped[str] = mapped_column(String(64), nullable=False)

    #: What was counted: "Sarees, ground floor", "Rack 4". Free text on purpose
    #: — a shop's sections are not a taxonomy anyone will maintain.
    scope: Mapped[str | None] = mapped_column(String(255), nullable=True)

    status: Mapped[StockCountStatus] = mapped_column(
        _StatusType(), nullable=False, default=StockCountStatus.DRAFT, index=True
    )

    #: A blind count hides the system quantity from whoever is counting.
    #:
    #: Not a gimmick. Shown the expected figure, a tired person at the end of a
    #: shift writes it down instead of counting, and the sheet comes back with
    #: a perfect zero variance that proves nothing. Blind is the default for
    #: exactly that reason; it can be turned off for a quick recount of a
    #: known discrepancy, where the whole point is to look at the difference.
    is_blind: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    counted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: Who accepted the variances. Deliberately separate from who counted:
    #: a stock write-off is a money decision and should not be self-approved.
    posted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    posted_at: Mapped[str | None] = mapped_column(String(40), nullable=True)

    store: Mapped["Store"] = relationship(lazy="raise")
    lines: Mapped[list["StockCountLine"]] = relationship(
        back_populates="count",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="StockCountLine.created_at",
    )


class StockCountLine(UUIDPKMixin, TimestampMixin, Base):
    """One variant on one sheet: what the system thought, and what was there."""

    __tablename__ = "stock_count_lines"
    __table_args__ = (
        # One line per variant per sheet. Counting the same variant twice on
        # one sheet is a data-entry mistake, and silently keeping both would
        # post the variance twice.
        UniqueConstraint("count_id", "variant_id", name="uq_stock_count_lines_count_variant"),
    )

    count_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stock_counts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("product_variants.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    #: What the books said WHEN THE LINE WAS ENTERED. Snapshotted, never
    #: re-read at post time — see the module docstring. This is the whole
    #: reason an evening's sales are not silently reversed by a count.
    system_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)

    #: What the person found on the shelf.
    counted_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)

    #: counted − system, stored rather than derived. The figure that gets
    #: posted to the ledger, fixed at entry time so a later balance change
    #: cannot quietly alter what this sheet is about to do.
    variance: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)

    #: Why it differs, when the counter knows — "2 damaged in monsoon",
    #: "found behind rack". A variance with a reason is a correction; one
    #: without is shrinkage, and a manager needs to be able to tell them apart.
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    count: Mapped[StockCount] = relationship(back_populates="lines")
    variant: Mapped["ProductVariant"] = relationship(lazy="selectin")
