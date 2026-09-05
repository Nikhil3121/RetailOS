"""Loyalty endpoints — program config, balances, redemption, statement."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import CurrentUser, DbSession, require_min_role
from app.db.models.user import UserRole
from app.db.models.loyalty import MembershipTier
from app.schemas.loyalty import (
    AdjustRequest,
    LoyaltyBalance,
    LoyaltyLedgerRead,
    LoyaltyProgramRead,
    LoyaltyProgramUpsert,
    MembershipTierCreate,
    MembershipTierRead,
    RedeemQuote,
    RedeemRequest,
    RedeemResult,
)
from app.services.audit import AuditService
from app.services.loyalty import LoyaltyService

router = APIRouter(prefix="/loyalty", tags=["loyalty"])


# ---------------------------------------------------------------------------
# Program configuration
# ---------------------------------------------------------------------------


@router.get(
    "/program",
    response_model=LoyaltyProgramRead | None,
    summary="The active rewards program, or null when the shop runs none.",
)
async def get_program(db: DbSession) -> LoyaltyProgramRead | None:
    program = await LoyaltyService(db).program()
    return LoyaltyProgramRead.model_validate(program) if program else None


@router.put(
    "/program",
    response_model=LoyaltyProgramRead,
    summary="Create or update the rewards program.",
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def upsert_program(
    payload: LoyaltyProgramUpsert, db: DbSession, user: CurrentUser
) -> LoyaltyProgramRead:
    """Owner-only. This sets the rate at which the shop issues a liability."""
    program = await LoyaltyService(db).set_program(
        name=payload.name,
        points_per_rupee=payload.points_per_rupee,
        redemption_rate=payload.redemption_rate,
        expiry_days=payload.expiry_days,
        is_active=payload.is_active,
    )
    await AuditService(db).log(
        action="loyalty.program_set",
        summary=(
            f"Rewards: {payload.points_per_rupee} pts/₹, "
            f"redeem at ₹{payload.redemption_rate}/pt"
        ),
        entity_type="loyalty_program",
        entity_id=program.id,
        actor=user,
        changes=payload.model_dump(mode="json"),
    )
    return LoyaltyProgramRead.model_validate(program)


@router.get("/tiers", response_model=list[MembershipTierRead], summary="Membership tiers.")
async def list_tiers(db: DbSession) -> list[MembershipTierRead]:
    return [MembershipTierRead.model_validate(t) for t in await LoyaltyService(db).tiers()]


@router.post(
    "/tiers",
    response_model=MembershipTierRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add a membership tier.",
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def create_tier(
    payload: MembershipTierCreate, db: DbSession, user: CurrentUser
) -> MembershipTierRead:
    tier = MembershipTier(**payload.model_dump())
    db.add(tier)
    await db.flush()
    await AuditService(db).log(
        action="loyalty.tier_created",
        summary=f"Created tier {tier.name} at ₹{tier.min_lifetime_spend} lifetime spend",
        entity_type="membership_tier",
        entity_id=tier.id,
        actor=user,
    )
    return MembershipTierRead.model_validate(tier)


# ---------------------------------------------------------------------------
# One customer
# ---------------------------------------------------------------------------


@router.get(
    "/{customer_id}",
    response_model=LoyaltyBalance,
    summary="A customer's points balance and tier.",
)
async def get_balance(customer_id: uuid.UUID, db: DbSession) -> LoyaltyBalance:
    return LoyaltyBalance.model_validate(await LoyaltyService(db).balance(customer_id))


@router.get(
    "/{customer_id}/statement",
    response_model=list[LoyaltyLedgerRead],
    summary="Every movement of this customer's points, newest first.",
)
async def get_statement(
    customer_id: uuid.UUID, db: DbSession, limit: int = Query(100, ge=1, le=500)
) -> list[LoyaltyLedgerRead]:
    """The authority behind the balance.

    A customer who disputes their points needs to be shown WHY, and a running
    total cannot answer that. Every row carries the balance it produced.
    """
    rows = await LoyaltyService(db).statement(customer_id, limit=limit)
    return [LoyaltyLedgerRead.model_validate(r) for r in rows]


@router.post(
    "/{customer_id}/quote",
    response_model=RedeemQuote,
    summary="What these points are worth. Spends nothing.",
)
async def quote(
    customer_id: uuid.UUID, payload: RedeemRequest, db: DbSession
) -> RedeemQuote:
    """Billing calls this to show the customer a figure before they commit."""
    points, rupees = await LoyaltyService(db).quote_redemption(
        customer_id=customer_id, points=payload.points
    )
    return RedeemQuote(points=points, rupees=rupees)


@router.post(
    "/{customer_id}/redeem",
    response_model=RedeemResult,
    summary="Spend points for a rupee discount.",
)
async def redeem(
    customer_id: uuid.UUID,
    payload: RedeemRequest,
    db: DbSession,
    user: CurrentUser,
) -> RedeemResult:
    service = LoyaltyService(db)
    entry, rupees = await service.redeem(
        customer_id=customer_id,
        points=payload.points,
        sale_id=payload.sale_id,
        reason=payload.reason,
        user_id=user.id,
    )
    await AuditService(db).log(
        action="loyalty.redeemed",
        summary=f"Redeemed {payload.points} points for ₹{rupees}",
        entity_type="customer",
        entity_id=customer_id,
        actor=user,
        changes={"points": str(payload.points), "rupees": str(rupees)},
    )
    return RedeemResult(
        points_spent=payload.points,
        rupees_granted=rupees,
        points_balance=entry.points_balance_after,
    )


@router.post(
    "/{customer_id}/adjust",
    response_model=LoyaltyLedgerRead,
    summary="Manually correct a points balance. Always audited.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def adjust(
    customer_id: uuid.UUID,
    payload: AdjustRequest,
    db: DbSession,
    user: CurrentUser,
) -> LoyaltyLedgerRead:
    entry = await LoyaltyService(db).adjust(
        customer_id=customer_id,
        points=payload.points,
        reason=payload.reason,
        user_id=user.id,
    )
    await AuditService(db).log(
        action="loyalty.adjusted",
        summary=f"Adjusted points by {payload.points}: {payload.reason}",
        entity_type="customer",
        entity_id=customer_id,
        actor=user,
        changes={"points": str(payload.points), "reason": payload.reason},
    )
    return LoyaltyLedgerRead.model_validate(entry)
