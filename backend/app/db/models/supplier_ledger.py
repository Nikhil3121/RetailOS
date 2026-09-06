"""What the shop owes each supplier, what a purchase really cost, and repricing.

Three models that close three gaps the outgoing system covered and RetailOS did
not — each backed by real usage in the export: 1,222 ledger rows, 1,148 charge
rows, 130 rate changes.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, ForeignKey, Numeric, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from app.db.models.supplier import Supplier


class SupplierEntryType(str, Enum):
    """Why the supplier's balance moved."""

    #: Goods received — the shop now owes the money.
    PURCHASE = "purchase"
    #: Money paid to the supplier.
    PAYMENT = "payment"
    #: Goods sent back — the debt falls.
    PURCHASE_RETURN = "purchase_return"
    #: A manual correction. Always carries a description.
    ADJUSTMENT = "adjustment"
    #: What was owed when the shop started using RetailOS.
    OPENING_BALANCE = "opening_balance"


class SupplierLedgerEntry(UUIDPKMixin, TimestampMixin, Base):
    """One movement on a supplier's account.

    DEBIT AND CREDIT ARE SEPARATE COLUMNS, not one signed amount. That is how a
    ledger is read on paper, and a sign error in a single column is invisible —
    a payment recorded with the wrong sign would silently double the debt
    instead of clearing it.

    Convention, from the SHOP's point of view:
        credit  the shop owes more  (goods received)
        debit   the shop owes less  (payment made, goods returned)

    Outstanding is the sum of the entries. There is deliberately no running
    `balance` column on `suppliers`: a cached total drifts the moment one
    document is edited, and a balance nobody trusts is worse than none.
    """

    __tablename__ = "supplier_ledger_entries"

    supplier_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("suppliers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    store_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("stores.id", ondelete="SET NULL"), nullable=True
    )

    #: When it HAPPENED, which is not when it was typed in. A payment made on
    #: Saturday and entered on Monday belongs to Saturday.
    entry_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    entry_type: Mapped[str] = mapped_column(String(24), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(64), nullable=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)

    debit: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    credit: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )

    purchase_order_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("purchase_orders.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    supplier: Mapped["Supplier"] = relationship(lazy="raise")


class PurchaseOrderCharge(UUIDPKMixin, TimestampMixin, Base):
    """Freight, labour, insurance — or a deduction the mill allowed.

    These are the difference between the INVOICE rate and the LANDED cost. A
    bale that costs ₹40,000 with ₹1,200 of freight really cost ₹41,200, and
    without this the margin on every garment in it is overstated.

    `tax_rate` is per charge because freight is taxed at a different rate from
    the goods it carries.
    """

    __tablename__ = "purchase_order_charges"

    purchase_order_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("purchase_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    tax_rate: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0.00")
    )

    #: The legacy "kalti" — an allowance knocked OFF the bill for a shortage or
    #: damage. A flag rather than a negative amount, so a report can show
    #: charges and deductions as the separate things they are.
    is_deduction: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    @property
    def signed_total(self) -> Decimal:
        """Amount including its own tax, negative when it is a deduction."""
        gross = (self.amount * (Decimal("1") + self.tax_rate / Decimal("100"))).quantize(
            Decimal("0.01")
        )
        return -gross if self.is_deduction else gross


class PriceChange(UUIDPKMixin, TimestampMixin, Base):
    """A repricing, recorded so it can be reviewed later.

    The audit log already records THAT a product was edited. It cannot answer
    "what did we reprice last month, from what, to what" — which is the
    question actually asked, and the one the outgoing system answered with
    `RATEALTERATION`.

    Every column is nullable because a change may touch only one of the three
    prices, and writing the unchanged ones would make a report of "what moved"
    impossible.
    """

    __tablename__ = "price_change_log"

    variant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("product_variants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    old_cost_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    new_cost_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    old_mrp: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    new_mrp: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    old_selling_price: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    new_selling_price: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )

    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    changed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
