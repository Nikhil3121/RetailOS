"""Unit-of-measure endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbSession, require_min_role
from app.db.models.user import UserRole
from app.schemas.common import Page
from app.schemas.unit import UnitCreate, UnitRead, UnitUpdate
from app.services.unit import UnitService

router = APIRouter(prefix="/units", tags=["units"])


@router.get(
    "",
    response_model=Page[UnitRead],
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_units(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
) -> Page[UnitRead]:
    rows, total = await UnitService(db).list(page=page, page_size=page_size)
    return Page[UnitRead](
        items=[UnitRead.model_validate(r) for r in rows],
        total=total, page=page, page_size=page_size,
    )


@router.post(
    "",
    response_model=UnitRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def create_unit(payload: UnitCreate, db: DbSession) -> UnitRead:
    unit = await UnitService(db).create(payload)
    return UnitRead.model_validate(unit)


@router.get(
    "/{unit_id}",
    response_model=UnitRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def get_unit(unit_id: uuid.UUID, db: DbSession) -> UnitRead:
    return UnitRead.model_validate(await UnitService(db).get(unit_id))


@router.patch(
    "/{unit_id}",
    response_model=UnitRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def update_unit(unit_id: uuid.UUID, payload: UnitUpdate, db: DbSession) -> UnitRead:
    return UnitRead.model_validate(await UnitService(db).update(unit_id, payload))


@router.delete(
    "/{unit_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def delete_unit(unit_id: uuid.UUID, db: DbSession) -> None:
    await UnitService(db).delete(unit_id)