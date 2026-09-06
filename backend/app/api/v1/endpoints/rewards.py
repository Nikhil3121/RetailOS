"""Gift scheme endpoints — manage the ladder, preview a bill, count what went out."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, require_elevation, require_min_role
from app.db.models.sale import Sale, SaleDocType, SaleStatus
from app.db.models.user import UserRole
from app.schemas.reward import (
    RewardGiven,
    RewardPreview,
    RewardSchemeCreate,
    RewardSchemeRead,
    RewardSchemeUpdate,
)
from app.services.audit import AuditService
from app.services.reward import RewardService

router = APIRouter(prefix="/rewards", tags=["rewards"])


# ---------------------------------------------------------------------------
# The ladder
# ---------------------------------------------------------------------------


@router.get("", response_model=list[RewardSchemeRead], summary="Every gift scheme.")
async def list_schemes(
    db: DbSession,
    store_id: uuid.UUID | None = Query(
        None, description="Schemes for this branch, plus the ones that run everywhere."
    ),
    include_inactive: bool = Query(False),
) -> list[RewardSchemeRead]:
    rows = await RewardService(db).list_schemes(
        store_id=store_id, include_inactive=include_inactive
    )
    return [RewardSchemeRead.model_validate(r) for r in rows]


@router.post(
    "",
    response_model=RewardSchemeRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add a rung to the gift ladder.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def create_scheme(
    payload: RewardSchemeCreate, db: DbSession, user: CurrentUser
) -> RewardSchemeRead:
    scheme = await RewardService(db).create(**payload.model_dump())
    await AuditService(db).log(
        action="reward.created",
        summary=f"Gift scheme '{scheme.name}': {scheme.gift_label} at ₹{scheme.min_bill_amount}",
        entity_type="reward_scheme",
        entity_id=scheme.id,
        actor=user,
        changes=payload.model_dump(mode="json"),
    )
    return RewardSchemeRead.model_validate(scheme)


@router.get(
    "/{scheme_id}", response_model=RewardSchemeRead, summary="One gift scheme."
)
async def get_scheme(scheme_id: uuid.UUID, db: DbSession) -> RewardSchemeRead:
    return RewardSchemeRead.model_validate(await RewardService(db).get(scheme_id))


@router.patch(
    "/{scheme_id}",
    response_model=RewardSchemeRead,
    summary="Change a gift scheme.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def update_scheme(
    scheme_id: uuid.UUID,
    payload: RewardSchemeUpdate,
    db: DbSession,
    user: CurrentUser,
) -> RewardSchemeRead:
    changes = payload.model_dump(exclude_unset=True)
    scheme = await RewardService(db).update(scheme_id, changes)
    await AuditService(db).log(
        action="reward.updated",
        summary=f"Updated gift scheme '{scheme.name}'",
        entity_type="reward_scheme",
        entity_id=scheme.id,
        actor=user,
        changes=payload.model_dump(exclude_unset=True, mode="json"),
    )
    return RewardSchemeRead.model_validate(scheme)


@router.delete(
    "/{scheme_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a gift scheme. Bills that earned it keep what they printed.",
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.MANAGER))],
)
async def delete_scheme(
    scheme_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> None:
    scheme = await RewardService(db).get(scheme_id)
    name = scheme.name
    await RewardService(db).delete(scheme_id)
    await AuditService(db).log(
        action="reward.deleted",
        summary=f"Deleted gift scheme '{name}'",
        entity_type="reward_scheme",
        entity_id=scheme_id,
        actor=user,
    )


# ---------------------------------------------------------------------------
# Billing
# ---------------------------------------------------------------------------


@router.get(
    "/preview/{store_id}",
    response_model=RewardPreview,
    summary="What a bill of this size earns, and what it is short of.",
)
async def preview(
    store_id: uuid.UUID,
    db: DbSession,
    amount: Decimal = Query(..., ge=0, description="The bill total so far."),
) -> RewardPreview:
    """Called by the billing screen as the cart changes.

    It uses the SAME function the sale service uses when it records the gift, so
    what the cashier promises and what the bill records cannot diverge.
    """
    outcome = await RewardService(db).evaluate(store_id=store_id, amount=amount)
    return RewardPreview(
        earned=(
            RewardSchemeRead.model_validate(outcome.earned) if outcome.earned else None
        ),
        next_scheme=(
            RewardSchemeRead.model_validate(outcome.next_scheme)
            if outcome.next_scheme
            else None
        ),
        amount_to_next=outcome.amount_to_next,
    )


# ---------------------------------------------------------------------------
# What it cost
# ---------------------------------------------------------------------------


@router.get(
    "/reports/given",
    response_model=list[RewardGiven],
    summary="How many gifts went out, by gift.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def gifts_given(
    db: DbSession,
    store_id: uuid.UUID | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> list[RewardGiven]:
    """Counted from the BILLS, not from a counter on the scheme.

    A counter would drift the first time a bill was voided. Grouping the bills
    means a voided sale drops out of the count on its own, and the answer is
    always reconstructable from the invoices themselves.

    Grouped by the SNAPSHOTTED label, so a promotion that was later renamed —
    or deleted — still reports what customers were actually handed.
    """
    stmt = (
        select(
            Sale.reward_scheme_id,
            Sale.reward_label,
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.grand_total), 0),
        )
        .where(
            Sale.reward_label.is_not(None),
            Sale.status == SaleStatus.COMPLETED,
            Sale.doc_type == SaleDocType.SALE,
        )
        .group_by(Sale.reward_scheme_id, Sale.reward_label)
        .order_by(func.count(Sale.id).desc())
    )
    if store_id is not None:
        stmt = stmt.where(Sale.store_id == store_id)
    if from_date is not None:
        stmt = stmt.where(func.date(Sale.created_at) >= from_date)
    if to_date is not None:
        stmt = stmt.where(func.date(Sale.created_at) <= to_date)

    rows = (await db.execute(stmt)).all()
    return [
        RewardGiven(
            reward_scheme_id=scheme_id,
            gift_label=label,
            times_given=int(count),
            total_bill_value=Decimal(str(total)),
        )
        for scheme_id, label, count, total in rows
    ]
