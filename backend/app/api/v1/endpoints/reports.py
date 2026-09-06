"""Basic report endpoints."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbSession, require_min_role
from app.core.business_day import business_date
from app.db.models.user import UserRole
from app.schemas.report import (
    DailySalesRow,
    DayBook,
    ItemProfitReport,
    SalesBreakdownRow,
    SalesSummary,
    TopProductRow,
)
from app.schemas.gstr1 import Gstr1Return
from app.services.gstr1 import Gstr1Service
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
    # OWNER, not manager — unlike every other report here.
    #
    # A margin report is a cost-price report: anyone who can read it knows what
    # the shop pays its suppliers. That is the owner's business, not the
    # counter's, and in a part-owned branch it is commercially sensitive. The
    # sales breakdowns next door stay at manager level because revenue is
    # something a manager is meant to be managing.
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def item_profit(
    db: DbSession,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    store_id: uuid.UUID | None = None,
    limit: int = Query(200, ge=1, le=1000),
) -> ItemProfitReport:
    """Owner only.

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
    day: date | None = Query(
        None,
        description=(
            "Defaults to today in UTC, which is the clock every timestamp in "
            "the database is on. See the note below."
        ),
    ),
    store_id: uuid.UUID | None = Query(
        None,
        description=(
            "Required for an expected-cash figure — a drawer belongs to a "
            "branch, so without one there is nothing to reconcile against."
        ),
    ),
) -> DayBook:
    """
    THE DEFAULT IS THE SHOP'S TODAY.

    Which is UTC unless `BUSINESS_TIMEZONE` says otherwise — never the
    server's own local clock, because that would make the figures depend on
    where the process happens to be running.

    It matters at exactly the hour this report is used. A shop closing at 1am
    IST: the server's local date has rolled over, the UTC date has not, and
    picking the wrong one hands the operator a day book for a day that has
    not started — empty drawer, no session, no bills.
    """
    return await ReportService(db).day_book(
        day=day or business_date(), store_id=store_id
    )


@router.get(
    "/gstr1",
    response_model=Gstr1Return,
    summary="GSTR-1 working paper for one branch and one period.",
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def gstr1(
    db: DbSession,
    store_id: uuid.UUID = Query(
        ...,
        description=(
            "Required. A return is filed against ONE GSTIN, and the two malls "
            "file separately — a combined figure is not a return anybody can "
            "submit."
        ),
    ),
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
) -> Gstr1Return:
    """The arithmetic of GSTR-1, laid out the way the return is laid out.

    NOT A PORTAL UPLOAD. The GSTN JSON schema is versioned and rejects on
    details that only surface on submission; this system has never touched the
    portal, and emitting "portal-ready" JSON it has never had validated is how
    a wrong return gets filed with confidence.

    What it does do is remove the month of hand-adding: B2B invoice-wise, B2C
    summarised by place of supply and rate, credit notes reported POSITIVE as
    the return expects, the HSN summary, and the document ranges.

    Read `warnings` before filing. Lines with no HSN code and customers with a
    malformed GSTIN are named there rather than quietly reducing a total.
    """
    default = _default_range()
    return await Gstr1Service(db).build(
        store_id=store_id,
        from_date=from_date or default[0],
        to_date=to_date or default[1],
    )
