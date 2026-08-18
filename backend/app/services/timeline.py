"""Customer timeline — merges sales and coupon redemptions into one feed."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.db.models.coupon import Coupon, CouponRedemption
from app.db.models.customer import Customer
from app.db.models.sale import Sale, SaleStatus
from app.schemas.timeline import TimelineEntry, TimelineKind, TimelinePayload


class TimelineService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def build(
        self, customer_id: uuid.UUID, *, limit: int = 100
    ) -> TimelinePayload:
        if await self.db.get(Customer, customer_id) is None:
            raise NotFoundError("Customer not found.", code="CUSTOMER_NOT_FOUND")

        entries: list[TimelineEntry] = []

        # Sales
        sales = (
            await self.db.scalars(
                select(Sale)
                .where(Sale.customer_id == customer_id)
                .order_by(Sale.created_at.desc())
                .limit(limit)
            )
        ).all()
        for s in sales:
            if s.status == SaleStatus.VOIDED:
                entries.append(
                    TimelineEntry(
                        kind=TimelineKind.SALE_VOIDED,
                        at=s.voided_at or s.created_at,
                        title=f"Voided invoice {s.number}",
                        subtitle=s.void_reason,
                        amount=s.grand_total,
                        reference=s.number,
                        sale_id=s.id,
                    )
                )
            else:
                entries.append(
                    TimelineEntry(
                        kind=TimelineKind.SALE,
                        at=s.completed_at or s.created_at,
                        title=f"Invoice {s.number}",
                        subtitle=None,
                        amount=s.grand_total,
                        reference=s.number,
                        sale_id=s.id,
                    )
                )

        # Coupon redemptions
        joined = (
            await self.db.execute(
                select(CouponRedemption, Coupon)
                .join(Coupon, Coupon.id == CouponRedemption.coupon_id)
                .where(CouponRedemption.customer_id == customer_id)
                .order_by(CouponRedemption.created_at.desc())
                .limit(limit)
            )
        ).all()
        for red, coupon in joined:
            entries.append(
                TimelineEntry(
                    kind=TimelineKind.COUPON_REDEMPTION,
                    at=red.created_at,
                    title=f"Coupon {coupon.code}",
                    subtitle=coupon.name,
                    amount=red.discount_amount,
                    reference=coupon.code,
                    sale_id=red.sale_id,
                    coupon_id=coupon.id,
                )
            )

        entries.sort(key=lambda e: e.at, reverse=True)
        return TimelinePayload(customer_id=customer_id, entries=entries[:limit])
