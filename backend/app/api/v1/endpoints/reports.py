"""Basic report endpoints."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbSession, require_min_role
from app.db.models.user import UserRole
from app.schemas.report import (
    DailySalesRow,
    DayBook,
    ItemProfitReport,
    SalesBreakdownRow,
    SalesSummary,
    TopProductRow,
)
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


@router.get(
    "/sales-by",
    response_model=list[SalesBreakdownRow],
    summary="Takings sliced by brand, category, size or salesperson.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def sales_by(
    db: DbSession,
    dimension: str = Query(
        ...,
        description="brand | category | size | salesperson",
    ),
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    store_id: uuid.UUID | None = None,
    limit: int = Query(100, ge=1, le=500),
) -> list[SalesBreakdownRow]:
    """One endpoint for four reports.

    They are the same question asked of four different columns. Four separate
    endpoints would drift apart within a month, and the shop would end up with
    a by-brand figure that does not reconcile with the by-category one.
    """
    default = _default_range()
    return await ReportService(db).sales_breakdown(
        dimension=dimension,
        from_date=from_date or default[0],
        to_date=to_date or default[1],
        store_id=store_id,
        limit=limit,
    )


@router.get(
    "/item-profit",
    response_model=ItemProfitReport,
    summary="Margin per item, from the cost recorded at the time of sale.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def item_profit(
    db: DbSession,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    store_id: uuid.UUID | None = None,
    limit: int = Query(200, ge=1, le=1000),
) -> ItemProfitReport:
    """Owner-visible margin. Manager and above.

    The response carries `uncosted_lines` and `uncosted_revenue`: sales in the
    period that have no cost recorded and are therefore NOT in the totals.
    Anything rendering this must show them — a margin presented as complete
    when it covers half the period is worse than no margin at all.
    """
    default = _default_range()
    return await ReportService(db).item_profit(
        from_date=from_date or default[0],
        to_date=to_date or default[1],
        store_id=store_id,
        limit=limit,
    )


@router.get(
    "/day-book",
    response_model=DayBook,
    summary="Every money movement on one day, and what the drawer should hold.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def day_book(
    db: DbSession,
    day: date | None = Query(None, description="Defaults to today."),
    store_id: uuid.UUID | None = Query(
        None,
        description=(
            "Required for an expected-cash figure — a drawer belongs to a "
            "branch, so without one there is nothing to reconcile against."
        ),
    ),
) -> DayBook:
    return await ReportService(db).day_book(day=day or date.today(), store_id=store_id)
