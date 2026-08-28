"""Basic reports — daily summary, top products, daily trend.

Numbers are computed directly from the ledger, uncached, so the values in
these responses always match the source of truth on disk.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.sale import (
    PaymentMethod,
    Sale,
    SaleLine,
    SalePayment,
    SaleStatus,
)
from app.schemas.report import DailySalesRow, SalesSummary, TopProductRow


_ZERO = Decimal("0.00")


def _dec(v) -> Decimal:
    return Decimal(str(v or 0))


class ReportService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def sales_summary(
        self,
        *,
        from_date: date,
        to_date: date,
        store_id: uuid.UUID | None = None,
    ) -> SalesSummary:
        base = select(Sale).where(
            func.date(Sale.created_at).between(from_date, to_date),
            Sale.status == SaleStatus.COMPLETED,
        )
        if store_id is not None:
            base = base.where(Sale.store_id == store_id)

        header = (
            await self.db.execute(
                select(
                    func.count(Sale.id),
                    func.coalesce(func.sum(Sale.grand_total), 0),
                    func.coalesce(func.sum(Sale.tax_total), 0),
                    func.coalesce(func.sum(Sale.discount_total), 0),
                    func.coalesce(func.sum(Sale.subtotal), 0),
                ).where(
                    func.date(Sale.created_at).between(from_date, to_date),
                    Sale.status == SaleStatus.COMPLETED,
                    *([Sale.store_id == store_id] if store_id is not None else []),
                )
            )
        ).one()

        # Payment split — join into the same date/store filter.
        payments = (
            await self.db.execute(
                select(
                    SalePayment.method,
                    func.coalesce(func.sum(SalePayment.amount), 0),
                )
                .join(Sale, Sale.id == SalePayment.sale_id)
                .where(
                    func.date(Sale.created_at).between(from_date, to_date),
                    Sale.status == SaleStatus.COMPLETED,
                    *([Sale.store_id == store_id] if store_id is not None else []),
                )
                .group_by(SalePayment.method)
            )
        ).all()
        pay_map: dict[PaymentMethod, Decimal] = {m: _dec(t) for m, t in payments}

        return SalesSummary(
            from_date=from_date,
            to_date=to_date,
            sales_count=int(header[0] or 0),
            gross_total=_dec(header[1]),
            tax_total=_dec(header[2]),
            discount_total=_dec(header[3]),
            net_total=_dec(header[4]),
            cash_total=pay_map.get(PaymentMethod.CASH, _ZERO),
            card_total=pay_map.get(PaymentMethod.CARD, _ZERO),
            upi_total=pay_map.get(PaymentMethod.UPI, _ZERO),
            other_total=pay_map.get(PaymentMethod.OTHER, _ZERO),
        )

    async def top_products(
        self,
        *,
        from_date: date,
        to_date: date,
        store_id: uuid.UUID | None = None,
        limit: int = 10,
    ) -> list[TopProductRow]:
        stmt = (
            select(
                SaleLine.variant_id,
                SaleLine.sku,
                SaleLine.product_name,
                func.sum(SaleLine.quantity).label("qty"),
                func.sum(SaleLine.line_total).label("revenue"),
            )
            .join(Sale, Sale.id == SaleLine.sale_id)
            .where(
                func.date(Sale.created_at).between(from_date, to_date),
                Sale.status == SaleStatus.COMPLETED,
            )
            .group_by(SaleLine.variant_id, SaleLine.sku, SaleLine.product_name)
            .order_by(func.sum(SaleLine.line_total).desc())
            .limit(limit)
        )
        if store_id is not None:
            stmt = stmt.where(Sale.store_id == store_id)

        rows = (await self.db.execute(stmt)).all()
        return [
            TopProductRow(
                variant_id=r.variant_id,
                sku=r.sku,
                product_name=r.product_name,
                quantity_sold=_dec(r.qty),
                revenue=_dec(r.revenue),
            )
            for r in rows
        ]

    async def daily_trend(
        self,
        *,
        from_date: date,
        to_date: date,
        store_id: uuid.UUID | None = None,
    ) -> list[DailySalesRow]:
        stmt = (
            select(
                func.date(Sale.created_at).label("day"),
                func.count(Sale.id).label("cnt"),
                func.coalesce(func.sum(Sale.grand_total), 0).label("gross"),
            )
            .where(
                func.date(Sale.created_at).between(from_date, to_date),
                Sale.status == SaleStatus.COMPLETED,
            )
            .group_by(func.date(Sale.created_at))
            .order_by(func.date(Sale.created_at))
        )
        if store_id is not None:
            stmt = stmt.where(Sale.store_id == store_id)

        rows = (await self.db.execute(stmt)).all()
        by_day: dict[date, tuple[int, Decimal]] = {}
        for r in rows:
            d = r.day if isinstance(r.day, date) else date.fromisoformat(str(r.day))
            by_day[d] = (int(r.cnt or 0), _dec(r.gross))

        out: list[DailySalesRow] = []
        current = from_date
        while current <= to_date:
            cnt, gross = by_day.get(current, (0, _ZERO))
            out.append(DailySalesRow(day=current, sales_count=cnt, gross_total=gross))
            current += timedelta(days=1)
        return out
