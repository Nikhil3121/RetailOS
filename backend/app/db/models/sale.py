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


class SaleDocType(str, Enum):
    """What kind of document a `sales` row is.

    STATUS AND TYPE ARE DIFFERENT AXES and must not be conflated. `status` says
    whether the document still stands; `doc_type` says what it is. A credit note
    can itself be voided, which is only expressible if the two stay separate.
    """

    SALE = "sale"
    RETURN = "return"
    # Money taken before goods are given — a wedding order paid up front. It
    # has NO lines and grand_total 0, because an advance is not revenue until
    # something is actually delivered. The money sits as a negative
    # balance_due, i.e. the shop owes the customer goods.
    ADVANCE = "advance"


class _SaleDocTypeType(TypeDecorator):
    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, SaleDocType):
            return value.value
        return SaleDocType(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        return SaleDocType(value)


class PaymentMethod(str, Enum):
    CASH = "cash"
    CARD = "card"
    UPI = "upi"
    OTHER = "other"
    #: The value of goods handed back, spent on the bill that replaces them.
    #:
    #: A tender, not a discount. An exchange is TWO GST documents — a credit
    #: note for what came back and a full-value invoice for what went out —
    #: and folding the credit into the new bill as a discount would understate
    #: the invoice, misstate its GST, and leave the returned goods with no
    #: credit note at all.
    #:
    #: It is also, deliberately, not cash: nothing left the drawer, so the day
    #: book must not count it as if something had.
    CREDIT_NOTE = "credit_note"


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
        # Credit notes must carry their own serial series under GST, so the
        # counter is keyed by document type as well as store and month.
        UniqueConstraint(
            "store_id",
            "year_month",
            "doc_type",
            name="uq_sale_number_sequences_store_month_type",
        ),
    )

    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stores.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    year_month: Mapped[str] = mapped_column(String(6), nullable=False, index=True)  # e.g. "202607"
    doc_type: Mapped[str] = mapped_column(String(16), nullable=False, default="sale")
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

    # ---- returns / credit notes -------------------------------------------
    # A return is this same row shape with NEGATIVE money and doc_type=RETURN.
    # Storing the sign here is what keeps every existing SUM() correct without
    # modification: revenue nets returns out, and a cash refund subtracts itself
    # from the shift's expected cash. See migration 0016 for the full rationale.
    doc_type: Mapped[SaleDocType] = mapped_column(
        _SaleDocTypeType(), nullable=False, default=SaleDocType.SALE, index=True
    )
    # The invoice this credit note reverses. Always set on a return, always NULL
    # on a sale.
    original_sale_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sales.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
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
    # ---- money off the whole bill -------------------------------------------
    #
    # Held at the BILL level and deliberately not spread across the lines.
    # Allocating it would change each line's taxable value and therefore its
    # GST, which is a tax decision rather than a display one. The per-line tax
    # already computed stands exactly as it was.
    #
    # This one column is what unblocked three things: a plain "₹200 off",
    # coupons (built, with a validate endpoint, and unreachable because there
    # was nowhere to put the money), and loyalty redemption reducing the bill
    # it was redeemed against.
    bill_discount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    bill_discount_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Signed. -0.40 takes 240.40 down to 240; +0.60 takes 239.40 up to 240.
    #
    # Stored rather than recomputed on display: it is part of what the customer
    # actually paid, and re-deriving it later under a changed rounding rule
    # would make an old bill stop adding up.
    round_off: Mapped[Decimal] = mapped_column(
        Numeric(6, 2), nullable=False, default=Decimal("0.00")
    )

    # The coupon applied, plus a SNAPSHOT of its code. Snapshotted for the same
    # reason as the reward label below: a coupon renamed or deleted next month
    # must not change what a printed bill says was used.
    coupon_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("coupons.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    coupon_code: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # ---- gift earned on this bill ------------------------------------------
    #
    # The scheme it came from, plus a SNAPSHOT of what the customer was handed.
    # The label is stored rather than joined for the same reason `mrp` is:
    # renaming the scheme in December must not rewrite a November bill, and
    # deleting the scheme must not erase what was actually given.
    #
    # Counting these is how the shop knows what a promotion cost. There is no
    # counter on the scheme, because a counter drifts the first time a bill is
    # voided.
    # How many times this bill has been printed. 1 is the original; anything
    # above marks the paper as a DUPLICATE, because two identical-looking
    # copies of one invoice is how a bill gets paid twice.
    print_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    reward_scheme_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("reward_schemes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    reward_label: Mapped[str | None] = mapped_column(String(128), nullable=True)

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
    # The printed MRP AT THE TIME OF SALE. Snapshotted, not read back from the
    # variant, because today's MRP on a three-month-old bill would show the
    # customer a saving they never received. NULL on lines written before this.
    mrp: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    # Which branch's RANGE this SKU came from, as it stood at the time of sale.
    #
    # Snapshotted for the same reason as `mrp` above: re-assigning a SKU to
    # another range next month must not rewrite a bill already printed and
    # handed to a customer.
    #
    # On the LINE, not the sale, because one customer can buy from both ranges
    # on one bill. This is what answers "how many MS1 items did MS2 sell
    # today"; it has no bearing on which store's stock was deducted.
    origin_store_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stores.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Who sold THIS line.
    #
    # `sales.salesperson_user_id` credits the whole bill to one person, and in
    # a garment shop two staff routinely split one — a saree from her, the
    # blouse from him. Commission is computed from this, so crediting it all to
    # whoever happened to be selected last is quietly wrong.
    #
    # NULL falls back to the bill's salesperson, so a simple sale and every
    # bill written before this behave exactly as they did.
    salesperson_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # What this unit COST the shop, at the time of sale.
    #
    # Snapshotted for the same reason as `mrp`: profit is revenue minus the
    # cost that was actually paid for the goods, and re-reading the variant's
    # cost_price today would re-price every historical bill every time a
    # supplier changes their rate. A season's margin would silently move.
    #
    # NULL on lines written before this column existed. The profit report says
    # how many such lines it could not cost rather than guessing — a margin
    # built on invented costs is worse than no margin at all.
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
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
