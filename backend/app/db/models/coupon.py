"""Coupons + redemption log.

A coupon has a code, a discount definition (percentage or flat), constraints
(min bill, expiry, usage cap), and optional customer scoping. Applying a
coupon at POS is a separate follow-up — this milestone owns storage +
validation only.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    pass


class CouponDiscountType(str, Enum):
    PERCENTAGE = "percentage"
    FLAT = "flat"


class _CouponTypeType(TypeDecorator):
    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, CouponDiscountType):
            return value.value
        return CouponDiscountType(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        return None if value is None else CouponDiscountType(value)


class Coupon(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "coupons"
    __table_args__ = (UniqueConstraint("code", name="uq_coupons_code"),)

    code: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    discount_type: Mapped[CouponDiscountType] = mapped_column(
        _CouponTypeType(), nullable=False
    )
    # For PERCENTAGE this is a % (0..100). For FLAT it's ₹.
    discount_value: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    # Cap PERCENTAGE discounts at this ₹ amount (NULL = uncapped).
    max_discount_amount: Mapped[Decimal | None] = mapped_column(
        Numeric(14, 2), nullable=True
    )

    min_bill_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )

    # NULL = unlimited redemptions.
    max_uses_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # NULL = unlimited per customer.
    max_uses_per_customer: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uses_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)

    # If set, only this customer may use it (birthday coupon, targeted offer).
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class CouponRedemption(UUIDPKMixin, TimestampMixin, Base):
    """Recorded each time a coupon is successfully applied to a sale."""

    __tablename__ = "coupon_redemptions"

    coupon_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("coupons.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    sale_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sales.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
