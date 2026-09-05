"""Commission rule CRUD + calculation endpoint."""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbSession, require_elevation, require_min_role
from app.db.models.user import UserRole
from app.schemas.commission import (
    CommissionLine,
    CommissionRuleCreate,
    CommissionRuleRead,
    CommissionRuleUpdate,
    CommissionRunResult,
)
from app.schemas.common import Page
from app.services.commission import CommissionCalculator, CommissionRuleService

router = APIRouter(prefix="/commissions", tags=["commissions"])


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------


@router.get(
    "/rules",
    response_model=Page[CommissionRuleRead],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def list_rules(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    is_active: bool | None = None,
) -> Page[CommissionRuleRead]:
    rows, total = await CommissionRuleService(db).list(
        page=page, page_size=page_size, is_active=is_active
    )
    return Page[CommissionRuleRead](
        items=[CommissionRuleRead.model_validate(r) for r in rows],
        total=total, page=page, page_size=page_size,
    )


@router.post(
    "/rules",
    response_model=CommissionRuleRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def create_rule(payload: CommissionRuleCreate, db: DbSession) -> CommissionRuleRead:
    return CommissionRuleRead.model_validate(await CommissionRuleService(db).create(payload))


@router.get(
    "/rules/{rule_id}",
    response_model=CommissionRuleRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def get_rule(rule_id: uuid.UUID, db: DbSession) -> CommissionRuleRead:
    return CommissionRuleRead.model_validate(await CommissionRuleService(db).get(rule_id))


@router.patch(
    "/rules/{rule_id}",
    response_model=CommissionRuleRead,
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def update_rule(
    rule_id: uuid.UUID, payload: CommissionRuleUpdate, db: DbSession
) -> CommissionRuleRead:
    return CommissionRuleRead.model_validate(
        await CommissionRuleService(db).update(rule_id, payload)
    )


@router.delete(
    "/rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.OWNER))],
)
async def delete_rule(rule_id: uuid.UUID, db: DbSession) -> None:
    await CommissionRuleService(db).delete(rule_id)


# ---------------------------------------------------------------------------
# Calculation
# ---------------------------------------------------------------------------


@router.get(
    "/calculate",
    response_model=CommissionRunResult,
    summary="Roll up commission for a date range. Optionally scope to one staff member.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def calculate_commissions(
    db: DbSession,
    from_date: date = Query(...),
    to_date: date = Query(...),
    user_id: uuid.UUID | None = None,
) -> CommissionRunResult:
    result, _ = await CommissionCalculator(db).calculate(
        from_date=from_date, to_date=to_date, user_id=user_id, include_lines=False,
    )
    return result


@router.get(
    "/breakdown",
    response_model=list[CommissionLine],
    summary="Per-line commission breakdown (which rule paid which line).",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def commission_breakdown(
    db: DbSession,
    from_date: date = Query(...),
    to_date: date = Query(...),
    user_id: uuid.UUID | None = None,
) -> list[CommissionLine]:
    _, lines = await CommissionCalculator(db).calculate(
        from_date=from_date, to_date=to_date, user_id=user_id, include_lines=True,
    )
    return lines
