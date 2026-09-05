"""Loyalty DTOs — program config, balances, and the points ledger."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.db.models.loyalty import LoyaltyKind
from app.schemas.common import ORMModel

_ZERO = Decimal("0.00")


class LoyaltyProgramUpsert(BaseModel):
    """The shop's earn and burn rates.

    `points_per_rupee` and `redemption_rate` are separate numbers because they
    almost always differ: a shop might grant one point per rupee but redeem four
    points to the rupee, which is a 25% giveback rather than a 100% one.
    """

    name: str = Field(default="Rewards", min_length=1, max_length=128)
    points_per_rupee: Decimal = Field(ge=0, decimal_places=4, max_digits=10)
    redemption_rate: Decimal = Field(
        ge=0,
        decimal_places=4,
        max_digits=10,
        description="Rupees one point is worth when redeemed. 0.25 = four points to the rupee.",
    )
    expiry_days: int | None = Field(
        default=365, ge=1, description="Days until earned points lapse. NULL = never."
    )
    is_active: bool = True


class LoyaltyProgramRead(ORMModel):
    id: uuid.UUID
    name: str
    is_active: bool
    points_per_rupee: Decimal
    redemption_rate: Decimal
    expiry_days: int | None


class MembershipTierRead(ORMModel):
    id: uuid.UUID
    name: str
    min_lifetime_spend: Decimal
    points_multiplier: Decimal
    default_discount_pct: Decimal
    color: str | None
    sort_order: int
    is_active: bool


class MembershipTierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    min_lifetime_spend: Decimal = Field(default=_ZERO, ge=0, decimal_places=2, max_digits=14)
    points_multiplier: Decimal = Field(
        default=Decimal("1.000"), ge=0, decimal_places=3, max_digits=6
    )
    default_discount_pct: Decimal = Field(
        default=_ZERO, ge=0, le=100, decimal_places=2, max_digits=5
    )
    color: str | None = Field(default=None, max_length=32)
    sort_order: int = 0
    is_active: bool = True


class LoyaltyBalance(ORMModel):
    """What a customer holds right now.

    `points_balance` is a cache of the ledger, maintained in the same
    transaction as every movement. `GET /loyalty/{id}/statement` is the
    authority when the two are ever in question.
    """

    customer_id: uuid.UUID
    membership_tier_id: uuid.UUID | None
    points_balance: Decimal
    wallet_balance: Decimal
    lifetime_spend: Decimal
    lifetime_earned: Decimal
    lifetime_redeemed: Decimal
    last_activity_at: datetime | None
    tier: MembershipTierRead | None = None


class LoyaltyLedgerRead(ORMModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    kind: LoyaltyKind
    #: Signed — positive on earn, negative on redeem, reversal and expiry.
    points_delta: Decimal
    points_balance_after: Decimal
    sale_id: uuid.UUID | None
    reason: str | None
    expires_at: date | None
    created_at: datetime


class RedeemRequest(BaseModel):
    """Spend points. Rupee value is computed server-side, never accepted.

    Taking a rupee figure from the client would let a modified request grant an
    arbitrary discount for a handful of points.
    """

    points: Decimal = Field(gt=0, decimal_places=2, max_digits=14)
    sale_id: uuid.UUID | None = None
    reason: str | None = Field(default=None, max_length=255)


class RedeemQuote(BaseModel):
    """What a redemption WOULD be worth. Nothing is spent by asking."""

    points: Decimal
    rupees: Decimal


class RedeemResult(BaseModel):
    points_spent: Decimal
    rupees_granted: Decimal
    points_balance: Decimal


class AdjustRequest(BaseModel):
    """A manual correction by a manager.

    The reason is REQUIRED. An unexplained movement in a liability account is
    exactly what an audit exists to find, and leaving it optional guarantees it
    would be left blank.
    """

    points: Decimal = Field(decimal_places=2, max_digits=14)
    reason: str = Field(min_length=1, max_length=255)
