"""Purchase-analytics rollups over the existing purchase_orders + lines."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.product import Product, ProductVariant
from app.db.models.purchase import PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus
from app.db.models.supplier import Supplier
from app.schemas.purchase_analytics import (
    PurchaseAnalyticsSummary,
    PurchaseCostRow,
    PurchaseTrendPoint,
    SupplierScorecard,
)


_ZERO = Decimal("0.00")


def _dec(v) -> Decimal:
    return Decimal(str(v or 0))


class PurchaseAnalyticsService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def summary(
        self, *, from_date: date, to_date: date
    ) -> PurchaseAnalyticsSummary:
        base = [
            func.date(PurchaseOrder.created_at).between(from_date, to_date),
        ]
        totals = (
            await self.db.execute(
                select(
                    func.count(PurchaseOrder.id),
                    func.coalesce(func.sum(PurchaseOrder.grand_total), 0),
                    func.coalesce(
                        func.sum(
                            case(
                                (PurchaseOrder.status == PurchaseOrderStatus.RECEIVED, PurchaseOrder.grand_total),
                                else_=0,
                            )
                        ),
                        0,
                    ),
                    func.coalesce(
                        func.sum(
                            case(
                                (PurchaseOrder.status == PurchaseOrderStatus.CANCELLED, PurchaseOrder.grand_total),
                                else_=0,
                            )
                        ),
                        0,
                    ),
                    func.count(func.distinct(PurchaseOrder.supplier_id)),
                ).where(*base)
            )
        ).one()

        return PurchaseAnalyticsSummary(
            from_date=from_date,
            to_date=to_date,
            po_count=int(totals[0] or 0),
            total_spend=_dec(totals[1]),
            completed_spend=_dec(totals[2]),
            cancelled_spend=_dec(totals[3]),
            unique_suppliers=int(totals[4] or 0),
        )

    async def trend(
        self, *, from_date: date, to_date: date
    ) -> list[PurchaseTrendPoint]:
        stmt = (
            select(
                func.date(PurchaseOrder.created_at).label("d"),
                func.count(PurchaseOrder.id).label("cnt"),
                func.coalesce(func.sum(PurchaseOrder.grand_total), 0).label("total"),
            )
            .where(func.date(PurchaseOrder.created_at).between(from_date, to_date))
            .group_by(func.date(PurchaseOrder.created_at))
            .order_by(func.date(PurchaseOrder.created_at))
        )
        by_day: dict[date, tuple[int, Decimal]] = {}
        for r in (await self.db.execute(stmt)).all():
            d = r.d if isinstance(r.d, date) else date.fromisoformat(str(r.d))
            by_day[d] = (int(r.cnt or 0), _dec(r.total))

        out: list[PurchaseTrendPoint] = []
        cur = from_date
        while cur <= to_date:
            cnt, total = by_day.get(cur, (0, _ZERO))
            out.append(PurchaseTrendPoint(day=cur, po_count=cnt, total_spend=total))
            cur += timedelta(days=1)
        return out

    async def supplier_scorecards(
        self, *, from_date: date, to_date: date
    ) -> list[SupplierScorecard]:
        completed_case = case(
            (PurchaseOrder.status == PurchaseOrderStatus.RECEIVED, 1), else_=0
        )
        cancelled_case = case(
            (PurchaseOrder.status == PurchaseOrderStatus.CANCELLED, 1), else_=0
        )
        # Turnaround = received_at - order_date, only when both present.
        turnaround_days = case(
            (
                (PurchaseOrder.received_at.is_not(None))
                & (PurchaseOrder.order_date.is_not(None)),
                func.julianday(func.date(PurchaseOrder.received_at))
                - func.julianday(PurchaseOrder.order_date),
            ),
            else_=None,
        )
        # NOTE: julianday is SQLite-flavoured. Postgres uses EXTRACT(EPOCH...)/86400 —
        # swap here (or behind a dialect switch) when moving off SQLite.

        stmt = (
            select(
                Supplier.id,
                Supplier.name,
                Supplier.code,
                func.count(PurchaseOrder.id).label("po_count"),
                func.coalesce(func.sum(PurchaseOrder.grand_total), 0).label("total_spend"),
                func.coalesce(func.sum(completed_case), 0).label("completed"),
                func.coalesce(func.sum(cancelled_case), 0).label("cancelled"),
                func.avg(turnaround_days).label("avg_turnaround"),
                func.max(PurchaseOrder.order_date).label("last_order"),
            )
            .join(
                PurchaseOrder,
                (PurchaseOrder.supplier_id == Supplier.id)
                & (func.date(PurchaseOrder.created_at).between(from_date, to_date)),
                isouter=True,
            )
            .group_by(Supplier.id, Supplier.name, Supplier.code)
            .order_by(func.coalesce(func.sum(PurchaseOrder.grand_total), 0).desc())
        )

        out: list[SupplierScorecard] = []
        for r in (await self.db.execute(stmt)).all():
            avg = r.avg_turnaround
            avg_dec = (
                Decimal(str(avg)).quantize(Decimal("0.1")) if avg is not None else None
            )
            last = r.last_order
            if last and not isinstance(last, date):
                last = date.fromisoformat(str(last))
            out.append(
                SupplierScorecard(
                    supplier_id=r.id,
                    supplier_name=r.name,
                    supplier_code=r.code,
                    po_count=int(r.po_count or 0),
                    total_spend=_dec(r.total_spend),
                    completed_pos=int(r.completed or 0),
                    cancelled_pos=int(r.cancelled or 0),
                    avg_turnaround_days=avg_dec,
                    last_order_at=last,
                )
            )
        return out

    async def top_purchase_cost(
        self, *, from_date: date, to_date: date, limit: int = 20
    ) -> list[PurchaseCostRow]:
        stmt = (
            select(
                ProductVariant.id.label("variant_id"),
                ProductVariant.sku,
                Product.name.label("product_name"),
                func.coalesce(func.sum(PurchaseOrderLine.quantity), 0).label("ordered"),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                PurchaseOrder.status == PurchaseOrderStatus.RECEIVED,
                                PurchaseOrderLine.quantity,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("received"),
                func.coalesce(func.sum(PurchaseOrderLine.line_total), 0).label("total_cost"),
                func.avg(PurchaseOrderLine.unit_cost).label("avg_cost"),
            )
            .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderLine.purchase_order_id)
            .join(ProductVariant, ProductVariant.id == PurchaseOrderLine.variant_id)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(func.date(PurchaseOrder.created_at).between(from_date, to_date))
            .group_by(ProductVariant.id, ProductVariant.sku, Product.name)
            .order_by(func.sum(PurchaseOrderLine.line_total).desc())
            .limit(limit)
        )

        out: list[PurchaseCostRow] = []
        for r in (await self.db.execute(stmt)).all():
            out.append(
                PurchaseCostRow(
                    variant_id=r.variant_id,
                    sku=r.sku,
                    product_name=r.product_name,
                    total_units_ordered=_dec(r.ordered),
                    total_units_received=_dec(r.received),
                    total_cost=_dec(r.total_cost),
                    average_unit_cost=_dec(r.avg_cost).quantize(Decimal("0.01")),
                )
            )
        return out
