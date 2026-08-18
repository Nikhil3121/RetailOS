"""Billing endpoints — a thin view over Sale filtered on balance_due > 0.

Sales are the underlying record; "billing" here specifically means the
counter-side view of *unpaid balances* and *dues*, which the mall cashier uses
to see who still owes money and to collect against those bills.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbSession, require_min_role
from app.db.models.user import UserRole
from app.schemas.common import Page
from app.schemas.sale import SaleSummary
from app.services.sale import SaleService

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get(
    "/outstanding",
    response_model=Page[SaleSummary],
    summary="Every completed bill that still has a balance_due > 0.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_outstanding(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    store_id: uuid.UUID | None = None,
    customer_id: uuid.UUID | None = None,
) -> Page[SaleSummary]:
    rows, total = await SaleService(db).list_outstanding(
        store_id=store_id,
        customer_id=customer_id,
        page=page,
        page_size=page_size,
    )
    return Page[SaleSummary](items=rows, total=total, page=page, page_size=page_size)


@router.get(
    "/summary",
    summary="Total outstanding dues + counts, for the billing dashboard header.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def outstanding_summary(
    db: DbSession,
    store_id: uuid.UUID | None = None,
) -> dict[str, str | int]:
    return await SaleService(db).outstanding_summary(store_id=store_id)
