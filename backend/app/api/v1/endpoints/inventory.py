"""Inventory endpoints — stock levels, adjustments, transfers, and history."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import CurrentUser, DbSession, require_min_role
from app.db.models.user import UserRole
from app.schemas.common import Page
from app.schemas.inventory import (
    StockAdjustmentRequest,
    StockLevelRow,
    StockMovementRead,
    StockTransferRequest,
)
from app.services.inventory import InventoryService

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get(
    "/levels",
    response_model=Page[StockLevelRow],
    summary="Current stock quantity per (variant, store)",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def stock_levels(
    db: DbSession,
    store_id: uuid.UUID | None = None,
    search: str | None = None,
    stock_filter: str | None = Query(
        None,
        description="One of: in_stock, out_of_stock, low_stock. Omit for all.",
    ),
    include_inactive: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=1000),
) -> Page[StockLevelRow]:
    rows, total = await InventoryService(db).stock_levels(
        store_id=store_id,
        search=search,
        low_stock_only=stock_filter == "low_stock",
        out_of_stock_only=stock_filter == "out_of_stock",
        in_stock_only=stock_filter == "in_stock",
        include_inactive=include_inactive,
        page=page,
        page_size=page_size,
    )
    return Page[StockLevelRow](items=rows, total=total, page=page, page_size=page_size)


@router.get(
    "/movements",
    response_model=Page[StockMovementRead],
    summary="Ledger history",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def list_movements(
    db: DbSession,
    variant_id: uuid.UUID | None = None,
    store_id: uuid.UUID | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=1000),
) -> Page[StockMovementRead]:
    rows, total = await InventoryService(db).list_movements(
        variant_id=variant_id, store_id=store_id, page=page, page_size=page_size
    )
    return Page[StockMovementRead](
        items=[StockMovementRead.model_validate(m) for m in rows],
        total=total, page=page, page_size=page_size,
    )


@router.post(
    "/adjust",
    response_model=list[StockMovementRead],
    status_code=status.HTTP_201_CREATED,
    summary="Manual stock adjustment (breakage, cycle count, opening balance).",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def adjust_stock(
    payload: StockAdjustmentRequest,
    db: DbSession,
    user: CurrentUser,
) -> list[StockMovementRead]:
    movements = await InventoryService(db).adjust(payload, user_id=user.id)
    return [StockMovementRead.model_validate(m) for m in movements]


@router.post(
    "/transfer",
    response_model=list[StockMovementRead],
    status_code=status.HTTP_201_CREATED,
    summary="Move stock from one store to another.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def transfer_stock(
    payload: StockTransferRequest,
    db: DbSession,
    user: CurrentUser,
) -> list[StockMovementRead]:
    movements = await InventoryService(db).transfer(payload, user_id=user.id)
    return [StockMovementRead.model_validate(m) for m in movements]
