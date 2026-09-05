"""Category endpoints — flat list, tree, and standard CRUD."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbSession, require_elevation, require_min_role
from app.db.models.user import UserRole
from app.schemas.category import (
    CategoryCreate,
    CategoryRead,
    CategoryTreeNode,
    CategoryUpdate,
)
from app.schemas.common import Page
from app.services.category import CategoryService

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get(
    "",
    response_model=Page[CategoryRead],
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_categories(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(200, ge=1, le=500),
) -> Page[CategoryRead]:
    rows, total = await CategoryService(db).list(page=page, page_size=page_size)
    return Page[CategoryRead](
        items=[CategoryRead.model_validate(r) for r in rows],
        total=total, page=page, page_size=page_size,
    )


@router.get(
    "/tree",
    response_model=list[CategoryTreeNode],
    summary="Return the full category hierarchy as a nested tree.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def category_tree(db: DbSession) -> list[CategoryTreeNode]:
    return await CategoryService(db).tree()


@router.post(
    "",
    response_model=CategoryRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def create_category(payload: CategoryCreate, db: DbSession) -> CategoryRead:
    return CategoryRead.model_validate(await CategoryService(db).create(payload))


@router.get(
    "/{cat_id}",
    response_model=CategoryRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def get_category(cat_id: uuid.UUID, db: DbSession) -> CategoryRead:
    return CategoryRead.model_validate(await CategoryService(db).get(cat_id))


@router.patch(
    "/{cat_id}",
    response_model=CategoryRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def update_category(cat_id: uuid.UUID, payload: CategoryUpdate, db: DbSession) -> CategoryRead:
    return CategoryRead.model_validate(await CategoryService(db).update(cat_id, payload))


@router.delete(
    "/{cat_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.OWNER))],
)
async def delete_category(cat_id: uuid.UUID, db: DbSession) -> None:
    await CategoryService(db).delete(cat_id)
