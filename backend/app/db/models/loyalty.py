"""Loyalty — reward points, membership tiers, and the ledger behind them.

THE TABLES HERE ALREADY EXISTED. Migration 20260415_0006 created
`loyalty_programs`, `membership_tiers`, `customer_loyalty` and `loyalty_ledger`,
but no Python was ever written against them, so four tables sat in the database
with nothing able to read or write a single row. These models close that gap;
there is no new migration, and no column here is invented.

THE RULE THE WHOLE FEATURE TURNS ON
-----------------------------------
    THE LEDGER IS THE TRUTH. THE BALANCE IS A CACHE OF IT.

Every movement of points writes a ledger row carrying its own delta AND the
balance that resulted. `customer_loyalty.points_balance` is maintained
alongside so the till can show a number without summing a customer's history at
the counter, but it is derivable and must always agree with the ledger.

That shape is deliberate. Points are a liability the shop owes its customers,
and the question that eventually gets asked about a liability is not "what is
the balance" but "why". A running total alone cannot answer that; a ledger row
per movement can, and it is the same reasoning that put `points_balance_after`
in the schema in the first place.
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
    Integer,
    Numeric,
    String,
    TypeDecorator,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin, UtcDateTime

if TYPE_CHECKING:
    from app.db.models.customer import Customer
    from app.db.models.sale import Sale
    from app.db.models.user import User


class LoyaltyKind(str, Enum):
    """Why points moved.

    Stored as the string already in the schema (`kind`, VARCHAR(24)) rather than
    a database enum, so no migration is needed and adding a kind later is a code
    change rather than a schema change.
    """

    EARN = "earn"
    REDEEM = "redeem"
    #: Points taken back when the sale that earned them is returned or voided.
    #: A separate kind from REDEEM because a customer did not spend these — a
    #: statement that conflated the two would look like theft to the customer.
    REVERSAL = "reversal"
    #: A manual correction by a manager. Always carries a reason.
    ADJUSTMENT = "adjustment"
    EXPIRY = "expiry"


class _LoyaltyKindType(TypeDecorator):
    impl = String(24)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, LoyaltyKind):
            return value.value
        return LoyaltyKind(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        return None if value is None else LoyaltyKind(value)


class LoyaltyProgram(UUIDPKMixin, TimestampMixin, Base):
    """The shop's earn and burn rates. One active row is the working config."""

    __tablename__ = "loyalty_programs"

    name: Mapped[str] = mapped_column(String(128), nullable=False, default="Rewards")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    #: Points granted per rupee spent. Numeric(10,4), so "1 point per ₹100"
    #: is 0.0100 and does not have to be faked with integers.
    points_per_rupee: Mapped[Decimal] = mapped_column(
        Numeric(10, 4), nullable=False, default=Decimal("1.0000")
    )
    #: Rupees a single point is worth when redeemed. 0.2500 means four points
    #: to the rupee. Kept separate from the earn rate on purpose — a shop
    #: almost always redeems at a lower rate than it earns.
    redemption_rate: Mapped[Decimal] = mapped_column(
        Numeric(10, 4), nullable=False, default=Decimal("0.2500")
    )
    #: Days until earned points lapse. NULL means they never do.
    expiry_days: Mapped[int | None] = mapped_column(Integer, nullable=True, default=365)


class MembershipTier(UUIDPKMixin, TimestampMixin, Base):
    """Silver / Gold / Platinum, earned by lifetime spend."""

    __tablename__ = "membership_tiers"
    __table_args__ = (UniqueConstraint("name", name="uq_membership_tiers_name"),)

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    #: The threshold a customer's lifetime spend must reach for this tier.
    min_lifetime_spend: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00"), index=True
    )
    #: Multiplies the base earn rate. 1.500 = 50% more points for this tier.
    points_multiplier: Mapped[Decimal] = mapped_column(
        Numeric(6, 3), nullable=False, default=Decimal("1.000")
    )
    #: A standing discount for members of this tier. Applied by the biller, not
    #: here — this model stores the policy, never the arithmetic.
    default_discount_pct: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0.00")
    )
    color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class CustomerLoyalty(UUIDPKMixin, TimestampMixin, Base):
    """One row per enrolled customer: the balances, and the tier they've reached.

    Every figure here is a CACHE of the ledger, kept so the till can show a
    balance instantly. The ledger is what settles a dispute.
    """

    __tablename__ = "customer_loyalty"
    __table_args__ = (
        UniqueConstraint("customer_id", name="uq_customer_loyalty_customer_id"),
    )

    customer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    membership_tier_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("membership_tiers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    points_balance: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    #: Store credit in rupees, distinct from points. Not yet written by any
    #: flow; the column exists and is carried faithfully rather than dropped.
    wallet_balance: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    #: Drives tier promotion. Counts money spent, not points earned.
    lifetime_spend: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    lifetime_earned: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    lifetime_redeemed: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    last_activity_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)

    customer: Mapped["Customer"] = relationship(lazy="raise")
    tier: Mapped["MembershipTier | None"] = relationship(lazy="selectin")


class LoyaltyLedger(UUIDPKMixin, TimestampMixin, Base):
    """Every movement of points, and the balance it produced.

    Append-only in practice: nothing in the service updates or deletes a row.
    Correcting a mistake means writing an ADJUSTMENT, which is what leaves a
    trail a manager can actually follow.
    """

    __tablename__ = "loyalty_ledger"

    customer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[LoyaltyKind] = mapped_column(
        _LoyaltyKindType(), nullable=False, index=True
    )

    #: Signed. Positive on earn, negative on redeem, reversal and expiry — the
    #: same convention returns use, so a sum over the column is the balance.
    points_delta: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    wallet_delta: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )

    #: The balance AFTER this row was written. Snapshotted, not recomputed, so a
    #: statement printed months later shows what the customer was told at the
    #: time even if a later correction changed the running total.
    points_balance_after: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    wallet_balance_after: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)

    sale_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("sales.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    sale: Mapped["Sale | None"] = relationship(lazy="raise")
    created_by: Mapped["User | None"] = relationship(lazy="raise")
