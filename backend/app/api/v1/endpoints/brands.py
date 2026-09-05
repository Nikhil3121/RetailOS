"""Brand endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbSession, require_elevation, require_min_role
from app.db.models.user import UserRole
from app.schemas.brand import BrandCreate, BrandRead, BrandUpdate
from app.schemas.common import Page
from app.services.brand import BrandService

router = APIRouter(prefix="/brands", tags=["brands"])


@router.get(
    "",
    response_model=Page[BrandRead],
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_brands(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=1000),
) -> Page[BrandRead]:
    rows, total = await BrandService(db).list(page=page, page_size=page_size)
    return Page[BrandRead](
        items=[BrandRead.model_validate(r) for r in rows],
        total=total, page=page, page_size=page_size,
    )


@router.post(
    "",
    response_model=BrandRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def create_brand(payload: BrandCreate, db: DbSession) -> BrandRead:
    return BrandRead.model_validate(await BrandService(db).create(payload))


@router.get(
    "/{brand_id}",
    response_model=BrandRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def get_brand(brand_id: uuid.UUID, db: DbSession) -> BrandRead:
    return BrandRead.model_validate(await BrandService(db).get(brand_id))


@router.patch(
    "/{brand_id}",
    response_model=BrandRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def update_brand(brand_id: uuid.UUID, payload: BrandUpdate, db: DbSession) -> BrandRead:
    return BrandRead.model_validate(await BrandService(db).update(brand_id, payload))


@router.delete(
    "/{brand_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.OWNER))],
)
async def delete_brand(brand_id: uuid.UUID, db: DbSession) -> None:
    await BrandService(db).delete(brand_id)
