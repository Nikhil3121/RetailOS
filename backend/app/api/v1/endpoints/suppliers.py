"""Supplier endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbSession, require_elevation, require_min_role
from app.db.models.user import UserRole
from app.schemas.common import Page
from app.schemas.supplier import SupplierCreate, SupplierRead, SupplierUpdate
from app.services.supplier import SupplierService

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


@router.get(
    "",
    response_model=Page[SupplierRead],
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_suppliers(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    search: str | None = Query(None),
) -> Page[SupplierRead]:
    rows, total = await SupplierService(db).list(page=page, page_size=page_size, search=search)
    return Page[SupplierRead](
        items=[SupplierRead.model_validate(s) for s in rows],
        total=total, page=page, page_size=page_size,
    )


@router.post(
    "",
    response_model=SupplierRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def create_supplier(payload: SupplierCreate, db: DbSession) -> SupplierRead:
    return SupplierRead.model_validate(await SupplierService(db).create(payload))


@router.get(
    "/{supplier_id}",
    response_model=SupplierRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def get_supplier(supplier_id: uuid.UUID, db: DbSession) -> SupplierRead:
    return SupplierRead.model_validate(await SupplierService(db).get(supplier_id))


@router.patch(
    "/{supplier_id}",
    response_model=SupplierRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def update_supplier(
    supplier_id: uuid.UUID, payload: SupplierUpdate, db: DbSession
) -> SupplierRead:
    return SupplierRead.model_validate(await SupplierService(db).update(supplier_id, payload))


@router.delete(
    "/{supplier_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.OWNER))],
)
async def delete_supplier(supplier_id: uuid.UUID, db: DbSession) -> None:
    await SupplierService(db).delete(supplier_id)
