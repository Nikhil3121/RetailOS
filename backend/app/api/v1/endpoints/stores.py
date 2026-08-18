"""Store CRUD endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbSession, require_min_role
from app.db.models.user import UserRole
from app.schemas.common import Page
from app.schemas.store import StoreCreate, StoreRead, StoreUpdate
from app.services.store import StoreService

router = APIRouter(prefix="/stores", tags=["stores"])


@router.get(
    "",
    response_model=Page[StoreRead],
    summary="List stores",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_stores(
    db: DbSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=1000),
) -> Page[StoreRead]:
    rows, total = await StoreService(db).list(page=page, page_size=page_size)
    return Page[StoreRead](
        items=[StoreRead.model_validate(s) for s in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post(
    "",
    response_model=StoreRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a store",
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def create_store(payload: StoreCreate, db: DbSession) -> StoreRead:
    store = await StoreService(db).create(payload)
    return StoreRead.model_validate(store)


@router.get(
    "/{store_id}",
    response_model=StoreRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def get_store(store_id: uuid.UUID, db: DbSession) -> StoreRead:
    store = await StoreService(db).get(store_id)
    return StoreRead.model_validate(store)


@router.patch(
    "/{store_id}",
    response_model=StoreRead,
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def update_store(store_id: uuid.UUID, payload: StoreUpdate, db: DbSession) -> StoreRead:
    store = await StoreService(db).update(store_id, payload)
    return StoreRead.model_validate(store)


@router.delete(
    "/{store_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def delete_store(store_id: uuid.UUID, db: DbSession) -> None:
    await StoreService(db).delete(store_id)
