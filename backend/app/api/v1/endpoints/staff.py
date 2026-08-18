"""Staff performance + target endpoints."""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbSession, require_min_role
from app.db.models.commission import TargetPeriod
from app.db.models.user import UserRole
from app.schemas.commission import (
    StaffPerformanceReport,
    StaffTargetCreate,
    StaffTargetRead,
    StaffTargetUpdate,
    StaffTargetWithProgress,
)
from app.schemas.common import Page
from app.services.commission import StaffTargetService
from app.services.staff_performance import StaffPerformanceService

router = APIRouter(prefix="/staff", tags=["staff"])


# ---------------------------------------------------------------------------
# Performance
# ---------------------------------------------------------------------------


@router.get(
    "/performance",
    response_model=StaffPerformanceReport,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def performance(
    db: DbSession,
    from_date: date = Query(...),
    to_date: date = Query(...),
    store_id: uuid.UUID | None = None,
) -> StaffPerformanceReport:
    return await StaffPerformanceService(db).report(
        from_date=from_date, to_date=to_date, store_id=store_id,
    )


# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------


@router.get(
    "/targets",
    response_model=Page[StaffTargetRead],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def list_targets(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(200, ge=1, le=500),
    user_id: uuid.UUID | None = None,
    period: TargetPeriod | None = None,
) -> Page[StaffTargetRead]:
    rows, total = await StaffTargetService(db).list(
        user_id=user_id, period=period, page=page, page_size=page_size,
    )
    return Page[StaffTargetRead](
        items=[StaffTargetRead.model_validate(r) for r in rows],
        total=total, page=page, page_size=page_size,
    )


@router.post(
    "/targets",
    response_model=StaffTargetRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def create_target(payload: StaffTargetCreate, db: DbSession) -> StaffTargetRead:
    return StaffTargetRead.model_validate(await StaffTargetService(db).create(payload))


@router.get(
    "/targets/{target_id}",
    response_model=StaffTargetRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def get_target(target_id: uuid.UUID, db: DbSession) -> StaffTargetRead:
    return StaffTargetRead.model_validate(await StaffTargetService(db).get(target_id))


@router.get(
    "/targets/{target_id}/progress",
    response_model=StaffTargetWithProgress,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def target_progress(target_id: uuid.UUID, db: DbSession) -> StaffTargetWithProgress:
    svc = StaffTargetService(db)
    target = await svc.get(target_id)
    return await svc.with_progress(target)


@router.patch(
    "/targets/{target_id}",
    response_model=StaffTargetRead,
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def update_target(
    target_id: uuid.UUID, payload: StaffTargetUpdate, db: DbSession
) -> StaffTargetRead:
    return StaffTargetRead.model_validate(
        await StaffTargetService(db).update(target_id, payload)
    )


@router.delete(
    "/targets/{target_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def delete_target(target_id: uuid.UUID, db: DbSession) -> None:
    await StaffTargetService(db).delete(target_id)
