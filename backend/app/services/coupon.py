"""Coupon CRUD + validation + redemption logging.

`validate()` runs every gating rule (active flag, date window, min bill,
per-customer scope, usage caps) and computes the effective discount. It's a
pure read — POS will call it to preview; a future POS integration will call
`apply_to_sale()` when the checkout completes.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.db.models.coupon import Coupon, CouponDiscountType, CouponRedemption
from app.db.models.sale import Sale
from app.schemas.coupon import (
    CouponCreate,
    CouponRead,
    CouponUpdate,
    CouponValidateRequest,
    CouponValidateResponse,
)


_ZERO = Decimal("0.00")
_MONEY = Decimal("0.01")


def _round(v: Decimal) -> Decimal:
    return v.quantize(_MONEY, rounding=ROUND_HALF_UP)


class CouponService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------
    async def create(self, payload: CouponCreate) -> Coupon:
        clash = await self.db.scalar(
            select(Coupon).where(Coupon.code == payload.code.upper())
        )
        if clash is not None:
            raise ConflictError(
                "A coupon with this code already exists.", code="COUPON_CODE_TAKEN"
            )
        data = payload.model_dump()
        data["code"] = data["code"].upper()
        coupon = Coupon(**data)
        self.db.add(coupon)
        await self.db.flush()
        return coupon

    async def get(self, coupon_id: uuid.UUID) -> Coupon:
        row = await self.db.get(Coupon, coupon_id)
        if row is None:
            raise NotFoundError("Coupon not found.", code="COUPON_NOT_FOUND")
        return row

    async def list(
        self,
        *,
        page: int = 1,
        page_size: int = 100,
        is_active: bool | None = None,
    ) -> tuple[list[Coupon], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 500)
        base = select(Coupon)
        if is_active is not None:
            base = base.where(Coupon.is_active == is_active)
        total = await self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = (
            await self.db.scalars(
                base.order_by(Coupon.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    async def update(self, coupon_id: uuid.UUID, payload: CouponUpdate) -> Coupon:
        coupon = await self.get(coupon_id)
        for k, v in payload.model_dump(exclude_unset=True).items():
            setattr(coupon, k, v)
        await self.db.flush()
        return coupon

    async def delete(self, coupon_id: uuid.UUID) -> None:
        coupon = await self.get(coupon_id)
        await self.db.delete(coupon)
        await self.db.flush()

    # ------------------------------------------------------------------
    # Validation + redemption
    # ------------------------------------------------------------------
    async def validate(self, payload: CouponValidateRequest) -> CouponValidateResponse:
        coupon = await self.db.scalar(
            select(Coupon).where(Coupon.code == payload.code.upper())
        )
        if coupon is None:
            return CouponValidateResponse(valid=False, reason="Unknown coupon code.")

        if not coupon.is_active:
            return CouponValidateResponse(valid=False, reason="Coupon is inactive.", coupon=CouponRead.model_validate(coupon))

        today = date.today()
        if coupon.valid_from and today < coupon.valid_from:
            return CouponValidateResponse(
                valid=False, reason="Coupon is not yet active.",
                coupon=CouponRead.model_validate(coupon),
            )
        if coupon.valid_to and today > coupon.valid_to:
            return CouponValidateResponse(
                valid=False, reason="Coupon has expired.",
                coupon=CouponRead.model_validate(coupon),
            )

        if coupon.customer_id is not None and coupon.customer_id != payload.customer_id:
            return CouponValidateResponse(
                valid=False, reason="Coupon is reserved for another customer.",
                coupon=CouponRead.model_validate(coupon),
            )

        if payload.bill_amount < coupon.min_bill_amount:
            return CouponValidateResponse(
                valid=False,
                reason=f"Minimum bill of ₹{coupon.min_bill_amount} required.",
                coupon=CouponRead.model_validate(coupon),
            )

        if coupon.max_uses_total is not None and coupon.uses_count >= coupon.max_uses_total:
            return CouponValidateResponse(
                valid=False, reason="Coupon has hit its usage limit.",
                coupon=CouponRead.model_validate(coupon),
            )

        if (
            coupon.max_uses_per_customer is not None
            and payload.customer_id is not None
        ):
            used = await self.db.scalar(
                select(func.count(CouponRedemption.id)).where(
                    CouponRedemption.coupon_id == coupon.id,
                    CouponRedemption.customer_id == payload.customer_id,
                )
            ) or 0
            if used >= coupon.max_uses_per_customer:
                return CouponValidateResponse(
                    valid=False, reason="You have already used this coupon.",
                    coupon=CouponRead.model_validate(coupon),
                )

        discount = self._compute_discount(coupon, payload.bill_amount)
        return CouponValidateResponse(
            valid=True,
            coupon=CouponRead.model_validate(coupon),
            computed_discount=discount,
            final_amount=_round(payload.bill_amount - discount),
        )

    async def apply_to_sale(
        self,
        coupon_id: uuid.UUID,
        *,
        sale: Sale,
        discount_amount: Decimal,
    ) -> CouponRedemption:
        """Record that a coupon was consumed by a completed sale."""
        coupon = await self.get(coupon_id)
        coupon.uses_count += 1
        redemption = CouponRedemption(
            coupon_id=coupon.id,
            customer_id=sale.customer_id,
            sale_id=sale.id,
            discount_amount=_round(discount_amount),
        )
        self.db.add(redemption)
        await self.db.flush()
        return redemption

    def _compute_discount(self, coupon: Coupon, bill: Decimal) -> Decimal:
        if coupon.discount_type is CouponDiscountType.FLAT:
            return _round(min(coupon.discount_value, bill))
        # Percentage.
        raw = bill * (coupon.discount_value / Decimal("100"))
        if coupon.max_discount_amount is not None and raw > coupon.max_discount_amount:
            raw = coupon.max_discount_amount
        if raw > bill:
            raw = bill
        return _round(raw)

    async def redemptions_for_customer(
        self, customer_id: uuid.UUID, *, limit: int = 50
    ) -> list[CouponRedemption]:
        rows = (
            await self.db.scalars(
                select(CouponRedemption)
                .where(CouponRedemption.customer_id == customer_id)
                .order_by(CouponRedemption.created_at.desc())
                .limit(limit)
            )
        ).all()
        return list(rows)
