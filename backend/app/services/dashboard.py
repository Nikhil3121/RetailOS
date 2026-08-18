"""BI dashboard aggregation service.

One entry point (`build()`) computes every block the front-end needs. Under
the hood each block is a single lightweight query — none of them scan more
than the (typically small) rows created within the selected date window.

Profit is computed with the *current* variant cost as a proxy for the actual
cost at time of sale. A proper cost-accounting service (FIFO / weighted-avg)
would replace this without changing the shape of `estimated_profit`.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import case, extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.product import ProductVariant
from app.db.models.sale import (
    PaymentMethod,
    Sale,
    SaleLine,
    SalePayment,
    SaleStatus,
)
from app.db.models.store import Store
from app.schemas.dashboard import (
    DailyPoint,
    DashboardKPIs,
    DashboardPayload,
    HourlyBucket,
    KPIWithDelta,
    PaymentMix,
    Period,
    ProductProfitRow,
    StoreComparisonRow,
)


_ZERO = Decimal("0.00")


def _dec(v) -> Decimal:
    return Decimal(str(v or 0))


def _pct(cur: Decimal, prev: Decimal) -> Decimal | None:
    """Signed percentage change. None when previous is zero (undefined)."""
    if prev == 0:
        return None
    return ((cur - prev) / prev * Decimal("100")).quantize(Decimal("0.01"))


def _kpi(cur: Decimal, prev: Decimal) -> KPIWithDelta:
    return KPIWithDelta(
        current=cur,
        previous=prev,
        delta_absolute=(cur - prev),
        delta_pct=_pct(cur, prev),
    )


def resolve_range(period: Period, ref: date | None = None) -> tuple[date, date]:
    """Return (from_date, to_date) for a period. Both inclusive."""
    today = ref or date.today()
    if period is Period.TODAY:
        return today, today
    if period is Period.YESTERDAY:
        y = today - timedelta(days=1)
        return y, y
    if period is Period.WEEK:
        return today - timedelta(days=6), today
    if period is Period.MONTH:
        return today - timedelta(days=29), today
    if period is Period.YEAR:
        return today - timedelta(days=364), today
    raise ValueError(f"Unknown period {period!r}")


def previous_range(from_d: date, to_d: date) -> tuple[date, date]:
    """Return the immediately-preceding window of equal length."""
    span = (to_d - from_d).days
    end = from_d - timedelta(days=1)
    start = end - timedelta(days=span)
    return start, end


class DashboardService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def build(
        self,
        *,
        period: Period = Period.TODAY,
        store_id: uuid.UUID | None = None,
    ) -> DashboardPayload:
        from_d, to_d = resolve_range(period)
        prev_from, prev_to = previous_range(from_d, to_d)

        kpis = await self._kpis(from_d, to_d, prev_from, prev_to, store_id)
        hourly = await self._hourly(to_d, store_id)  # always today-of-range
        daily = await self._daily(from_d, to_d, store_id)
        payments = await self._payment_mix(from_d, to_d, store_id)
        top = await self._top_products(from_d, to_d, store_id, limit=10)
        stores = await self._store_comparison(from_d, to_d)

        return DashboardPayload(
            period=period,
            from_date=from_d,
            to_date=to_d,
            previous_from=prev_from,
            previous_to=prev_to,
            store_id=store_id,
            kpis=kpis,
            hourly=hourly,
            daily_trend=daily,
            payment_mix=payments,
            top_products=top,
            store_comparison=stores,
        )

    # ------------------------------------------------------------------
    # KPI block
    # ------------------------------------------------------------------
    async def _kpis(
        self,
        from_d: date,
        to_d: date,
        prev_from: date,
        prev_to: date,
        store_id: uuid.UUID | None,
    ) -> DashboardKPIs:
        current = await self._range_totals(from_d, to_d, store_id)
        previous = await self._range_totals(prev_from, prev_to, store_id)

        cur_profit = current["revenue"] - current["cost"]
        prev_profit = previous["revenue"] - previous["cost"]

        def _margin(rev: Decimal, prof: Decimal) -> Decimal:
            if rev == 0:
                return Decimal("0.00")
            return (prof / rev * Decimal("100")).quantize(Decimal("0.01"))

        return DashboardKPIs(
            revenue=_kpi(current["revenue"], previous["revenue"]),
            tax_collected=_kpi(current["tax"], previous["tax"]),
            discounts_given=_kpi(current["discount"], previous["discount"]),
            net_revenue=_kpi(current["net"], previous["net"]),
            sales_count=_kpi(Decimal(current["count"]), Decimal(previous["count"])),
            average_order_value=_kpi(current["aov"], previous["aov"]),
            unique_customers=_kpi(Decimal(current["customers"]), Decimal(previous["customers"])),
            estimated_profit=_kpi(cur_profit, prev_profit),
            estimated_margin_pct=_kpi(
                _margin(current["revenue"], cur_profit),
                _margin(previous["revenue"], prev_profit),
            ),
        )

    async def _range_totals(
        self, from_d: date, to_d: date, store_id: uuid.UUID | None
    ) -> dict:
        base_filter = [
            func.date(Sale.created_at).between(from_d, to_d),
            Sale.status == SaleStatus.COMPLETED,
        ]
        if store_id is not None:
            base_filter.append(Sale.store_id == store_id)

        header = (
            await self.db.execute(
                select(
                    func.count(Sale.id),
                    func.coalesce(func.sum(Sale.grand_total), 0),
                    func.coalesce(func.sum(Sale.tax_total), 0),
                    func.coalesce(func.sum(Sale.discount_total), 0),
                    func.coalesce(func.sum(Sale.subtotal), 0),
                    func.count(func.distinct(Sale.customer_id)),
                ).where(*base_filter)
            )
        ).one()

        count = int(header[0] or 0)
        revenue = _dec(header[1])
        aov = (revenue / Decimal(count)).quantize(Decimal("0.01")) if count else _ZERO

        # Estimated COGS — variant.cost_price × sold quantity, joined to sale rows.
        cost = _dec(
            await self.db.scalar(
                select(func.coalesce(func.sum(SaleLine.quantity * ProductVariant.cost_price), 0))
                .join(Sale, Sale.id == SaleLine.sale_id)
                .join(ProductVariant, ProductVariant.id == SaleLine.variant_id)
                .where(*base_filter)
            )
        )

        return {
            "count": count,
            "revenue": revenue,
            "tax": _dec(header[2]),
            "discount": _dec(header[3]),
            "net": _dec(header[4]),
            "customers": int(header[5] or 0),
            "aov": aov,
            "cost": cost,
        }

    # ------------------------------------------------------------------
    # Hourly (0..23) — used for the "today" heat / bar chart
    # ------------------------------------------------------------------
    async def _hourly(
        self, on_date: date, store_id: uuid.UUID | None
    ) -> list[HourlyBucket]:
        stmt = (
            select(
                extract("hour", Sale.created_at).label("hr"),
                func.count(Sale.id).label("cnt"),
                func.coalesce(func.sum(Sale.grand_total), 0).label("gross"),
            )
            .where(
                func.date(Sale.created_at) == on_date,
                Sale.status == SaleStatus.COMPLETED,
            )
            .group_by(extract("hour", Sale.created_at))
        )
        if store_id is not None:
            stmt = stmt.where(Sale.store_id == store_id)

        by_hour = {
            int(r.hr): (int(r.cnt or 0), _dec(r.gross))
            for r in (await self.db.execute(stmt)).all()
        }
        return [
            HourlyBucket(hour=h, sales_count=by_hour.get(h, (0, _ZERO))[0],
                         gross_total=by_hour.get(h, (0, _ZERO))[1])
            for h in range(24)
        ]

    # ------------------------------------------------------------------
    # Daily trend (per-day totals across the window)
    # ------------------------------------------------------------------
    async def _daily(
        self, from_d: date, to_d: date, store_id: uuid.UUID | None
    ) -> list[DailyPoint]:
        stmt = (
            select(
                func.date(Sale.created_at).label("d"),
                func.count(Sale.id).label("cnt"),
                func.coalesce(func.sum(Sale.grand_total), 0).label("gross"),
            )
            .where(
                func.date(Sale.created_at).between(from_d, to_d),
                Sale.status == SaleStatus.COMPLETED,
            )
            .group_by(func.date(Sale.created_at))
            .order_by(func.date(Sale.created_at))
        )
        if store_id is not None:
            stmt = stmt.where(Sale.store_id == store_id)

        by_day: dict[date, tuple[int, Decimal]] = {}
        for r in (await self.db.execute(stmt)).all():
            d = r.d if isinstance(r.d, date) else date.fromisoformat(str(r.d))
            by_day[d] = (int(r.cnt or 0), _dec(r.gross))

        out: list[DailyPoint] = []
        cur = from_d
        while cur <= to_d:
            cnt, gross = by_day.get(cur, (0, _ZERO))
            out.append(DailyPoint(day=cur, sales_count=cnt, gross_total=gross))
            cur += timedelta(days=1)
        return out

    # ------------------------------------------------------------------
    # Payment mix
    # ------------------------------------------------------------------
    async def _payment_mix(
        self, from_d: date, to_d: date, store_id: uuid.UUID | None
    ) -> PaymentMix:
        base = [
            func.date(Sale.created_at).between(from_d, to_d),
            Sale.status == SaleStatus.COMPLETED,
        ]
        if store_id is not None:
            base.append(Sale.store_id == store_id)

        rows = (
            await self.db.execute(
                select(SalePayment.method, func.coalesce(func.sum(SalePayment.amount), 0))
                .join(Sale, Sale.id == SalePayment.sale_id)
                .where(*base)
                .group_by(SalePayment.method)
            )
        ).all()
        by_m = {m: _dec(t) for m, t in rows}
        return PaymentMix(
            cash=by_m.get(PaymentMethod.CASH, _ZERO),
            card=by_m.get(PaymentMethod.CARD, _ZERO),
            upi=by_m.get(PaymentMethod.UPI, _ZERO),
            other=by_m.get(PaymentMethod.OTHER, _ZERO),
        )

    # ------------------------------------------------------------------
    # Top products with estimated profit
    # ------------------------------------------------------------------
    async def _top_products(
        self,
        from_d: date,
        to_d: date,
        store_id: uuid.UUID | None,
        limit: int,
    ) -> list[ProductProfitRow]:
        stmt = (
            select(
                SaleLine.variant_id,
                SaleLine.sku,
                SaleLine.product_name,
                func.sum(SaleLine.quantity).label("qty"),
                func.sum(SaleLine.line_total).label("revenue"),
                func.sum(SaleLine.quantity * ProductVariant.cost_price).label("cost"),
            )
            .join(Sale, Sale.id == SaleLine.sale_id)
            .join(ProductVariant, ProductVariant.id == SaleLine.variant_id)
            .where(
                func.date(Sale.created_at).between(from_d, to_d),
                Sale.status == SaleStatus.COMPLETED,
            )
            .group_by(SaleLine.variant_id, SaleLine.sku, SaleLine.product_name)
            .order_by(func.sum(SaleLine.line_total).desc())
            .limit(limit)
        )
        if store_id is not None:
            stmt = stmt.where(Sale.store_id == store_id)

        rows = (await self.db.execute(stmt)).all()
        out: list[ProductProfitRow] = []
        for r in rows:
            revenue = _dec(r.revenue)
            cost = _dec(r.cost)
            profit = revenue - cost
            margin = (
                (profit / revenue * Decimal("100")).quantize(Decimal("0.01"))
                if revenue > 0
                else None
            )
            out.append(
                ProductProfitRow(
                    variant_id=r.variant_id,
                    sku=r.sku,
                    product_name=r.product_name,
                    quantity_sold=_dec(r.qty),
                    revenue=revenue,
                    estimated_cost=cost,
                    estimated_profit=profit,
                    estimated_margin_pct=margin,
                )
            )
        return out

    # ------------------------------------------------------------------
    # Store comparison — ignores the store_id filter (that's the point)
    # ------------------------------------------------------------------
    async def _store_comparison(
        self, from_d: date, to_d: date
    ) -> list[StoreComparisonRow]:
        stmt = (
            select(
                Store.id,
                Store.code,
                Store.name,
                func.count(Sale.id).label("cnt"),
                func.coalesce(func.sum(Sale.grand_total), 0).label("gross"),
                func.coalesce(func.sum(Sale.tax_total), 0).label("tax"),
            )
            .join(Sale, Sale.store_id == Store.id, isouter=True)
            .where(
                (Sale.id.is_(None))
                | (
                    (func.date(Sale.created_at).between(from_d, to_d))
                    & (Sale.status == SaleStatus.COMPLETED)
                )
            )
            .group_by(Store.id, Store.code, Store.name)
            .order_by(func.coalesce(func.sum(Sale.grand_total), 0).desc(), Store.name)
        )
        rows = (await self.db.execute(stmt)).all()
        out: list[StoreComparisonRow] = []
        for r in rows:
            cnt = int(r.cnt or 0)
            gross = _dec(r.gross)
            aov = (gross / Decimal(cnt)).quantize(Decimal("0.01")) if cnt else _ZERO
            out.append(
                StoreComparisonRow(
                    store_id=r.id,
                    store_code=r.code,
                    store_name=r.name,
                    sales_count=cnt,
                    gross_total=gross,
                    tax_total=_dec(r.tax),
                    average_order_value=aov,
                )
            )
        return out
