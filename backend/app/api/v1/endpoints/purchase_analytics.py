"""Purchase-analytics endpoints."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbSession, require_min_role
from app.db.models.user import UserRole
from app.schemas.purchase_analytics import (
    PurchaseAnalyticsSummary,
    PurchaseCostRow,
    PurchaseTrendPoint,
    SupplierScorecard,
)
from app.services.purchase_analytics import PurchaseAnalyticsService

router = APIRouter(prefix="/purchase-analytics", tags=["purchase-analytics"])


def _default_range() -> tuple[date, date]:
    today = date.today()
    return today - timedelta(days=29), today


@router.get(
    "/summary",
    response_model=PurchaseAnalyticsSummary,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def summary(
    db: DbSession,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
) -> PurchaseAnalyticsSummary:
    default = _default_range()
    return await PurchaseAnalyticsService(db).summary(
        from_date=from_date or default[0],
        to_date=to_date or default[1],
    )


@router.get(
    "/trend",
    response_model=list[PurchaseTrendPoint],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def trend(
    db: DbSession,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
) -> list[PurchaseTrendPoint]:
    default = _default_range()
    return await PurchaseAnalyticsService(db).trend(
        from_date=from_date or default[0],
        to_date=to_date or default[1],
    )


@router.get(
    "/suppliers",
    response_model=list[SupplierScorecard],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def supplier_scorecards(
    db: DbSession,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
) -> list[SupplierScorecard]:
    default = _default_range()
    return await PurchaseAnalyticsService(db).supplier_scorecards(
        from_date=from_date or default[0],
        to_date=to_date or default[1],
    )


@router.get(
    "/top-cost",
    response_model=list[PurchaseCostRow],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def top_purchase_cost(
    db: DbSession,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
) -> list[PurchaseCostRow]:
    default = _default_range()
    return await PurchaseAnalyticsService(db).top_purchase_cost(
        from_date=from_date or default[0],
        to_date=to_date or default[1],
        limit=limit,
    )
