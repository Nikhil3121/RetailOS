"""Purchase-order endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import CurrentUser, DbSession, require_min_role
from app.db.models.purchase import PurchaseOrderStatus
from app.db.models.user import UserRole
from app.schemas.common import Page
from app.schemas.purchase import (
    PurchaseOrderCreate,
    PurchaseOrderRead,
    PurchaseOrderSummary,
    PurchaseOrderUpdate,
)
from app.services.purchase import PurchaseService

router = APIRouter(prefix="/purchase-orders", tags=["purchases"])


@router.get(
    "",
    response_model=Page[PurchaseOrderSummary],
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_purchase_orders(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    status_filter: PurchaseOrderStatus | None = Query(None, alias="status"),
    supplier_id: uuid.UUID | None = None,
    store_id: uuid.UUID | None = None,
) -> Page[PurchaseOrderSummary]:
    rows, total = await PurchaseService(db).list(
        page=page,
        page_size=page_size,
        status=status_filter,
        supplier_id=supplier_id,
        store_id=store_id,
    )
    return Page[PurchaseOrderSummary](items=rows, total=total, page=page, page_size=page_size)


@router.post(
    "",
    response_model=PurchaseOrderRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def create_purchase_order(
    payload: PurchaseOrderCreate,
    db: DbSession,
    user: CurrentUser,
) -> PurchaseOrderRead:
    po = await PurchaseService(db).create(payload, user_id=user.id)
    return PurchaseOrderRead.model_validate(po)


@router.get(
    "/{po_id}",
    response_model=PurchaseOrderRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def get_purchase_order(po_id: uuid.UUID, db: DbSession) -> PurchaseOrderRead:
    return PurchaseOrderRead.model_validate(await PurchaseService(db).get(po_id))


@router.patch(
    "/{po_id}",
    response_model=PurchaseOrderRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def update_purchase_order(
    po_id: uuid.UUID, payload: PurchaseOrderUpdate, db: DbSession
) -> PurchaseOrderRead:
    return PurchaseOrderRead.model_validate(await PurchaseService(db).update(po_id, payload))


@router.post(
    "/{po_id}/confirm",
    response_model=PurchaseOrderRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def confirm_purchase_order(po_id: uuid.UUID, db: DbSession) -> PurchaseOrderRead:
    return PurchaseOrderRead.model_validate(await PurchaseService(db).confirm(po_id))


@router.post(
    "/{po_id}/receive",
    response_model=PurchaseOrderRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def receive_purchase_order(
    po_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> PurchaseOrderRead:
    return PurchaseOrderRead.model_validate(
        await PurchaseService(db).receive(po_id, user_id=user.id)
    )


@router.post(
    "/{po_id}/cancel",
    response_model=PurchaseOrderRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def cancel_purchase_order(po_id: uuid.UUID, db: DbSession) -> PurchaseOrderRead:
    return PurchaseOrderRead.model_validate(await PurchaseService(db).cancel(po_id))
