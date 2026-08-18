"""BI dashboard + CSV export endpoints."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.api.deps import DbSession, require_min_role
from app.db.models.sale import SaleStatus
from app.db.models.user import UserRole
from app.schemas.dashboard import (
    DashboardPayload,
    HourlyBucket,
    Period,
    ProductProfitRow,
    StoreComparisonRow,
)
from app.services.dashboard import DashboardService, resolve_range
from app.services.sale import SaleService

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get(
    "",
    response_model=DashboardPayload,
    summary="One-shot BI payload — KPIs, hourly, daily trend, payment mix, top products, store compare.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def dashboard(
    db: DbSession,
    period: Period = Query(Period.TODAY),
    store_id: uuid.UUID | None = None,
) -> DashboardPayload:
    return await DashboardService(db).build(period=period, store_id=store_id)


@router.get(
    "/hourly",
    response_model=list[HourlyBucket],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def hourly(
    db: DbSession,
    on_date: date = Query(default_factory=date.today),
    store_id: uuid.UUID | None = None,
) -> list[HourlyBucket]:
    return await DashboardService(db)._hourly(on_date, store_id)  # noqa: SLF001


@router.get(
    "/store-comparison",
    response_model=list[StoreComparisonRow],
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def store_comparison(
    db: DbSession,
    period: Period = Query(Period.MONTH),
) -> list[StoreComparisonRow]:
    from_d, to_d = resolve_range(period)
    return await DashboardService(db)._store_comparison(from_d, to_d)  # noqa: SLF001


@router.get(
    "/top-products",
    response_model=list[ProductProfitRow],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def top_products(
    db: DbSession,
    period: Period = Query(Period.MONTH),
    store_id: uuid.UUID | None = None,
    limit: int = Query(20, ge=1, le=100),
) -> list[ProductProfitRow]:
    from_d, to_d = resolve_range(period)
    return await DashboardService(db)._top_products(  # noqa: SLF001
        from_d, to_d, store_id, limit=limit
    )


# ---------------------------------------------------------------------------
# CSV export — sales in a date range
# ---------------------------------------------------------------------------


@router.get(
    "/export/sales.csv",
    summary="Download completed sales for a date range as CSV.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def export_sales_csv(
    db: DbSession,
    from_date: date = Query(...),
    to_date: date = Query(...),
    store_id: uuid.UUID | None = None,
) -> StreamingResponse:
    rows, _ = await SaleService(db).list(
        store_id=store_id,
        status=SaleStatus.COMPLETED,
        from_date=from_date,
        to_date=to_date,
        page=1,
        page_size=10_000,
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "invoice_number",
            "date",
            "store_id",
            "customer_id",
            "line_count",
            "grand_total",
        ]
    )
    for s in rows:
        writer.writerow(
            [
                s.number,
                (s.completed_at or s.created_at).isoformat(),
                str(s.store_id),
                str(s.customer_id) if s.customer_id else "",
                s.line_count,
                str(s.grand_total),
            ]
        )

    filename = f"sales-{from_date}-to-{to_date}.csv"
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
