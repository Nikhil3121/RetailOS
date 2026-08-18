"""Commission rule + staff target DTOs."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator

from app.db.models.commission import CommissionScope, CommissionType, TargetPeriod
from app.schemas.common import ORMModel


class CommissionRuleBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None
    scope: CommissionScope
    commission_type: CommissionType
    rate: Decimal = Field(ge=0, decimal_places=4, max_digits=10)
    priority: int = 0

    product_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    brand_id: uuid.UUID | None = None
    staff_id: uuid.UUID | None = None

    effective_from: date | None = None
    effective_to: date | None = None
    is_active: bool = True

    @model_validator(mode="after")
    def _scope_target_matches(self) -> "CommissionRuleBase":
        # A PRODUCT-scoped rule must reference a product, etc.
        if self.scope is CommissionScope.PRODUCT and self.product_id is None:
            raise ValueError("PRODUCT-scoped rules require product_id.")
        if self.scope is CommissionScope.CATEGORY and self.category_id is None:
            raise ValueError("CATEGORY-scoped rules require category_id.")
        if self.scope is CommissionScope.BRAND and self.brand_id is None:
            raise ValueError("BRAND-scoped rules require brand_id.")
        if self.commission_type is CommissionType.PERCENTAGE and self.rate > 100:
            raise ValueError("Percentage rate cannot exceed 100.")
        if self.effective_from and self.effective_to and self.effective_from > self.effective_to:
            raise ValueError("effective_from must be on or before effective_to.")
        return self


class CommissionRuleCreate(CommissionRuleBase):
    pass


class CommissionRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    rate: Decimal | None = Field(default=None, ge=0, decimal_places=4, max_digits=10)
    priority: int | None = None
    effective_from: date | None = None
    effective_to: date | None = None
    is_active: bool | None = None


class CommissionRuleRead(ORMModel):
    id: uuid.UUID
    name: str
    description: str | None
    scope: CommissionScope
    commission_type: CommissionType
    rate: Decimal
    priority: int
    product_id: uuid.UUID | None
    category_id: uuid.UUID | None
    brand_id: uuid.UUID | None
    staff_id: uuid.UUID | None
    effective_from: date | None
    effective_to: date | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Staff targets
# ---------------------------------------------------------------------------


class StaffTargetCreate(BaseModel):
    user_id: uuid.UUID
    period: TargetPeriod
    period_start: date
    target_amount: Decimal = Field(gt=0, decimal_places=2, max_digits=14)
    notes: str | None = None


class StaffTargetUpdate(BaseModel):
    target_amount: Decimal | None = Field(default=None, gt=0, decimal_places=2, max_digits=14)
    notes: str | None = None


class StaffTargetRead(ORMModel):
    id: uuid.UUID
    user_id: uuid.UUID
    period: TargetPeriod
    period_start: date
    target_amount: Decimal
    notes: str | None
    created_at: datetime
    updated_at: datetime


class StaffTargetWithProgress(BaseModel):
    target: StaffTargetRead
    achieved_amount: Decimal
    achievement_pct: Decimal
    remaining_amount: Decimal


# ---------------------------------------------------------------------------
# Commission calculation output
# ---------------------------------------------------------------------------


class CommissionLine(BaseModel):
    """One line of resolved commission — links a sale line to the rule that paid it."""

    sale_id: uuid.UUID
    sale_number: str
    sale_line_id: uuid.UUID
    variant_id: uuid.UUID
    sku: str
    product_name: str
    quantity: Decimal
    line_total: Decimal
    rule_id: uuid.UUID | None
    rule_name: str | None
    commission_type: CommissionType | None
    rate: Decimal | None
    commission_amount: Decimal


class StaffCommissionSummary(BaseModel):
    user_id: uuid.UUID
    user_name: str
    from_date: date
    to_date: date
    total_revenue: Decimal
    total_commission: Decimal
    line_count: int


class CommissionRunResult(BaseModel):
    from_date: date
    to_date: date
    per_staff: list[StaffCommissionSummary]
    grand_total: Decimal


# ---------------------------------------------------------------------------
# Staff performance
# ---------------------------------------------------------------------------


class StaffPerformanceRow(BaseModel):
    user_id: uuid.UUID
    user_name: str
    role: str
    store_id: uuid.UUID | None
    sales_count: int
    revenue: Decimal
    average_bill_value: Decimal
    voided_count: int
    voided_amount: Decimal


class StaffPerformanceReport(BaseModel):
    from_date: date
    to_date: date
    store_id: uuid.UUID | None
    rows: list[StaffPerformanceRow]
