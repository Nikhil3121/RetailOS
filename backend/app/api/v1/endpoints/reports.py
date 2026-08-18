"""Basic report endpoints."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbSession, require_min_role
from app.db.models.user import UserRole
from app.schemas.report import DailySalesRow, SalesSummary, TopProductRow
from app.services.report import ReportService

router = APIRouter(prefix="/reports", tags=["reports"])


def _default_range() -> tuple[date, date]:
    today = date.today()
    return today - timedelta(days=6), today


@router.get(
    "/sales-summary",
    response_model=SalesSummary,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def sales_summary(
    db: DbSession,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    store_id: uuid.UUID | None = None,
) -> SalesSummary:
    default = _default_range()
    return await ReportService(db).sales_summary(
        from_date=from_date or default[0],
        to_date=to_date or default[1],
        store_id=store_id,
    )


@router.get(
    "/top-products",
    response_model=list[TopProductRow],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def top_products(
    db: DbSession,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    store_id: uuid.UUID | None = None,
    limit: int = Query(10, ge=1, le=100),
) -> list[TopProductRow]:
    default = _default_range()
    return await ReportService(db).top_products(
        from_date=from_date or default[0],
        to_date=to_date or default[1],
        store_id=store_id,
        limit=limit,
    )


@router.get(
    "/daily-trend",
    response_model=list[DailySalesRow],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def daily_trend(
    db: DbSession,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    store_id: uuid.UUID | None = None,
) -> list[DailySalesRow]:
    default = _default_range()
    return await ReportService(db).daily_trend(
        from_date=from_date or default[0],
        to_date=to_date or default[1],
        store_id=store_id,
    )
