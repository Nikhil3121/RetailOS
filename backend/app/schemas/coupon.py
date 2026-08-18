"""Coupon DTOs — CRUD + a validation payload."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator

from app.db.models.coupon import CouponDiscountType
from app.schemas.common import ORMModel


class CouponBase(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None

    discount_type: CouponDiscountType
    discount_value: Decimal = Field(gt=0, decimal_places=2, max_digits=10)
    max_discount_amount: Decimal | None = Field(default=None, gt=0, decimal_places=2, max_digits=14)

    min_bill_amount: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2, max_digits=14)

    max_uses_total: int | None = Field(default=None, ge=1)
    max_uses_per_customer: int | None = Field(default=None, ge=1)

    valid_from: date | None = None
    valid_to: date | None = None
    customer_id: uuid.UUID | None = None
    is_active: bool = True

    @model_validator(mode="after")
    def _sanity(self) -> "CouponBase":
        if self.discount_type is CouponDiscountType.PERCENTAGE and self.discount_value > 100:
            raise ValueError("Percentage discount cannot exceed 100.")
        if self.valid_from and self.valid_to and self.valid_from > self.valid_to:
            raise ValueError("valid_from must be on or before valid_to.")
        return self


class CouponCreate(CouponBase):
    pass


class CouponUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    discount_value: Decimal | None = Field(default=None, gt=0, decimal_places=2, max_digits=10)
    max_discount_amount: Decimal | None = Field(default=None, gt=0, decimal_places=2, max_digits=14)
    min_bill_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2, max_digits=14)
    max_uses_total: int | None = Field(default=None, ge=1)
    max_uses_per_customer: int | None = Field(default=None, ge=1)
    valid_from: date | None = None
    valid_to: date | None = None
    is_active: bool | None = None


class CouponRead(ORMModel):
    id: uuid.UUID
    code: str
    name: str
    description: str | None
    discount_type: CouponDiscountType
    discount_value: Decimal
    max_discount_amount: Decimal | None
    min_bill_amount: Decimal
    max_uses_total: int | None
    max_uses_per_customer: int | None
    uses_count: int
    valid_from: date | None
    valid_to: date | None
    customer_id: uuid.UUID | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CouponRedemptionRead(ORMModel):
    id: uuid.UUID
    coupon_id: uuid.UUID
    customer_id: uuid.UUID | None
    sale_id: uuid.UUID | None
    discount_amount: Decimal
    created_at: datetime


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


class CouponValidateRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    bill_amount: Decimal = Field(gt=0, decimal_places=2, max_digits=14)
    customer_id: uuid.UUID | None = None


class CouponValidateResponse(BaseModel):
    valid: bool
    reason: str | None = None
    coupon: CouponRead | None = None
    computed_discount: Decimal = Field(default=Decimal("0.00"))
    final_amount: Decimal = Field(default=Decimal("0.00"))
