"""Inventory-intelligence endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbSession, require_min_role
from app.db.models.user import UserRole
from app.schemas.inventory_intelligence import (
    InventoryAgingRow,
    InventoryHealthSummary,
    InventoryValueTotal,
    MovementRow,
    StockAlertRow,
    StockCategory,
)
from app.services.inventory_intelligence import InventoryIntelligenceService

router = APIRouter(prefix="/inventory/intelligence", tags=["inventory-intelligence"])


@router.get(
    "/summary",
    response_model=InventoryHealthSummary,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def health_summary(
    db: DbSession,
    window_days: int = Query(30, ge=1, le=365),
    dead_days: int = Query(60, ge=1, le=365),
    store_id: uuid.UUID | None = None,
) -> InventoryHealthSummary:
    return await InventoryIntelligenceService(db).health_summary(
        window_days=window_days, dead_days=dead_days, store_id=store_id,
    )


@router.get(
    "/alerts",
    response_model=list[StockAlertRow],
    summary="Every stock line labelled out/low/healthy/overstock with a reorder suggestion.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def stock_alerts(
    db: DbSession,
    category: list[StockCategory] | None = Query(default=None),
    store_id: uuid.UUID | None = None,
    window_days: int = Query(30, ge=1, le=365),
) -> list[StockAlertRow]:
    cats = set(category) if category else None
    return await InventoryIntelligenceService(db).stock_alerts(
        categories=cats, store_id=store_id, window_days=window_days,
    )


@router.get(
    "/movement",
    response_model=list[MovementRow],
    summary="Fast / slow / dead / normal classification by sales velocity.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def movement_analysis(
    db: DbSession,
    window_days: int = Query(30, ge=1, le=365),
    dead_days: int = Query(60, ge=1, le=365),
    store_id: uuid.UUID | None = None,
) -> list[MovementRow]:
    return await InventoryIntelligenceService(db).movement_analysis(
        window_days=window_days, dead_days=dead_days, store_id=store_id,
    )


@router.get(
    "/value",
    response_model=InventoryValueTotal,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def inventory_value(
    db: DbSession, store_id: uuid.UUID | None = None
) -> InventoryValueTotal:
    return await InventoryIntelligenceService(db).inventory_value(store_id=store_id)


@router.get(
    "/aging",
    response_model=list[InventoryAgingRow],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def inventory_aging(
    db: DbSession,
    store_id: uuid.UUID | None = None,
    limit: int = Query(500, ge=1, le=2000),
) -> list[InventoryAgingRow]:
    return await InventoryIntelligenceService(db).aging(
        store_id=store_id, limit=limit,
    )
