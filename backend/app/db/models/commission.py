"""Commission rules + staff targets.

Rules encode "who gets paid what for selling which items". They are not
posted per-sale — a calculation service walks sales at report time and
resolves the best-matching rule per line. Two consequences:

- Adjusting a rule doesn't retroactively rewrite history unless you re-run
  the calculation over the affected window.
- Historical commission is always reproducible from the sale ledger + the
  rules that were effective at the time.
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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from app.db.models.brand import Brand
    from app.db.models.category import Category
    from app.db.models.product import Product
    from app.db.models.user import User


# ---------------------------------------------------------------------------
# Enums + TypeDecorators
# ---------------------------------------------------------------------------


class CommissionScope(str, Enum):
    GLOBAL = "global"
    PRODUCT = "product"
    CATEGORY = "category"
    BRAND = "brand"


class CommissionType(str, Enum):
    PERCENTAGE = "percentage"
    FIXED = "fixed"


class TargetPeriod(str, Enum):
    MONTH = "month"
    QUARTER = "quarter"
    YEAR = "year"


class _ScopeType(TypeDecorator):
    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, CommissionScope):
            return value.value
        return CommissionScope(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        return None if value is None else CommissionScope(value)


class _TypeType(TypeDecorator):
    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, CommissionType):
            return value.value
        return CommissionType(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        return None if value is None else CommissionType(value)


class _PeriodType(TypeDecorator):
    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, TargetPeriod):
            return value.value
        return TargetPeriod(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        return None if value is None else TargetPeriod(value)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class CommissionRule(UUIDPKMixin, TimestampMixin, Base):
    """A single "sell X → earn Y" rule.

    Resolution order for a sold line:

    1. Filter by staff_id (rule staff_id matches the sale's cashier, or is NULL for everyone).
    2. Filter by scope match (GLOBAL always matches; PRODUCT/CATEGORY/BRAND require
       the sale line's variant to point at the same id).
    3. Filter by effective window.
    4. Sort: priority DESC, then scope specificity (PRODUCT > CATEGORY > BRAND > GLOBAL).
    """

    __tablename__ = "commission_rules"

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    scope: Mapped[CommissionScope] = mapped_column(_ScopeType(), nullable=False, index=True)
    commission_type: Mapped[CommissionType] = mapped_column(_TypeType(), nullable=False)

    # For PERCENTAGE this is a % (0..100). For FIXED it's ₹ per unit.
    rate: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)

    # Higher priority wins when multiple rules match. Default 0.
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)

    # NULL scope target → applies to any product/category/brand of the matching scope.
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=True, index=True
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("categories.id", ondelete="CASCADE"), nullable=True, index=True
    )
    brand_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("brands.id", ondelete="CASCADE"), nullable=True, index=True
    )

    # NULL staff → applies to everyone. Not-NULL → only that user.
    staff_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )

    effective_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    product: Mapped["Product | None"] = relationship("Product")
    category: Mapped["Category | None"] = relationship("Category")
    brand: Mapped["Brand | None"] = relationship("Brand")
    staff: Mapped["User | None"] = relationship("User")


class StaffTarget(UUIDPKMixin, TimestampMixin, Base):
    """Revenue target per (user, period). Achievement computed live at read time."""

    __tablename__ = "staff_targets"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "period", "period_start",
            name="uq_staff_targets_user_period_start",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    period: Mapped[TargetPeriod] = mapped_column(_PeriodType(), nullable=False, index=True)

    # First day of the period (2026-06-01 for June 2026 month target).
    period_start: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    target_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship("User")
