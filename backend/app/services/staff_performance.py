"""Staff performance rollups — computed live from the sales ledger."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.sale import Sale, SaleStatus
from app.db.models.user import User
from app.schemas.commission import StaffPerformanceReport, StaffPerformanceRow


_ZERO = Decimal("0.00")


def _dec(v) -> Decimal:
    return Decimal(str(v or 0))


class StaffPerformanceService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def report(
        self,
        *,
        from_date: date,
        to_date: date,
        store_id: uuid.UUID | None = None,
    ) -> StaffPerformanceReport:
        # One query — sums completed + voided in parallel so we don't scan sales twice.
        completed = case((Sale.status == SaleStatus.COMPLETED, 1), else_=0)
        voided = case((Sale.status == SaleStatus.VOIDED, 1), else_=0)
        completed_amt = case((Sale.status == SaleStatus.COMPLETED, Sale.grand_total), else_=0)
        voided_amt = case((Sale.status == SaleStatus.VOIDED, Sale.grand_total), else_=0)

        # Attribution key: prefer the explicitly-set salesperson (mall counter
        # workflow — the staff who actually made the sale, not the cashier at
        # the register), fall back to the cashier who rang it up when unset.
        attribution = func.coalesce(Sale.salesperson_user_id, Sale.created_by_user_id)

        stmt = (
            select(
                User.id,
                User.full_name,
                User.role,
                User.store_id,
                func.coalesce(func.sum(completed), 0).label("sales_count"),
                func.coalesce(func.sum(voided), 0).label("voided_count"),
                func.coalesce(func.sum(completed_amt), 0).label("revenue"),
                func.coalesce(func.sum(voided_amt), 0).label("voided_amount"),
            )
            .join(
                Sale,
                (attribution == User.id)
                & (func.date(Sale.created_at).between(from_date, to_date)),
                isouter=True,
            )
            .group_by(User.id, User.full_name, User.role, User.store_id)
            .order_by(func.coalesce(func.sum(completed_amt), 0).desc(), User.full_name)
        )
        if store_id is not None:
            # Attribution runs off Sale.store_id, not User.store_id — a staff member
            # can float between stores.
            stmt = stmt.where((Sale.store_id == store_id) | (Sale.id.is_(None)))

        result = await self.db.execute(stmt)
        rows: list[StaffPerformanceRow] = []
        for r in result.all():
            count = int(r.sales_count or 0)
            revenue = _dec(r.revenue)
            aov = (revenue / Decimal(count)).quantize(Decimal("0.01")) if count else _ZERO
            role_str = r.role.value if hasattr(r.role, "value") else str(r.role)
            rows.append(
                StaffPerformanceRow(
                    user_id=r.id,
                    user_name=r.full_name,
                    role=role_str,
                    store_id=r.store_id,
                    sales_count=count,
                    revenue=revenue,
                    average_bill_value=aov,
                    voided_count=int(r.voided_count or 0),
                    voided_amount=_dec(r.voided_amount),
                )
            )
        return StaffPerformanceReport(
            from_date=from_date, to_date=to_date, store_id=store_id, rows=rows,
        )
