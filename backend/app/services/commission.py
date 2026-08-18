"""Commission engine + staff-target management.

`calculate()` is the workhorse: given a date window (and optionally a staff
id), it walks every completed sale line in range, resolves the best-matching
rule, and returns a per-line breakdown plus per-staff summaries.

Resolution order (best-first) for a given (staff, product):

    priority DESC → scope specificity (PRODUCT > CATEGORY > BRAND > GLOBAL)
                  → staff-specific rules > global rules of same scope
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, NotFoundError
from app.db.models.commission import (
    CommissionRule,
    CommissionScope,
    CommissionType,
    StaffTarget,
    TargetPeriod,
)
from app.db.models.product import Product, ProductVariant
from app.db.models.sale import Sale, SaleLine, SaleStatus
from app.db.models.user import User
from app.schemas.commission import (
    CommissionLine,
    CommissionRuleCreate,
    CommissionRuleUpdate,
    CommissionRunResult,
    StaffCommissionSummary,
    StaffTargetCreate,
    StaffTargetUpdate,
    StaffTargetWithProgress,
)


_ZERO = Decimal("0.00")
_MONEY = Decimal("0.01")
_SPECIFICITY = {
    CommissionScope.PRODUCT: 3,
    CommissionScope.CATEGORY: 2,
    CommissionScope.BRAND: 1,
    CommissionScope.GLOBAL: 0,
}


def _round(v: Decimal) -> Decimal:
    return v.quantize(_MONEY, rounding=ROUND_HALF_UP)


# =============================================================================
# Rule CRUD
# =============================================================================


class CommissionRuleService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, payload: CommissionRuleCreate) -> CommissionRule:
        rule = CommissionRule(**payload.model_dump())
        self.db.add(rule)
        await self.db.flush()
        return rule

    async def get(self, rule_id: uuid.UUID) -> CommissionRule:
        rule = await self.db.get(CommissionRule, rule_id)
        if rule is None:
            raise NotFoundError("Commission rule not found.", code="RULE_NOT_FOUND")
        return rule

    async def list(
        self,
        *,
        page: int = 1,
        page_size: int = 100,
        is_active: bool | None = None,
    ) -> tuple[list[CommissionRule], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 500)
        base = select(CommissionRule)
        if is_active is not None:
            base = base.where(CommissionRule.is_active == is_active)
        total = await self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = (
            await self.db.scalars(
                base.order_by(CommissionRule.priority.desc(), CommissionRule.name)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    async def update(
        self, rule_id: uuid.UUID, payload: CommissionRuleUpdate
    ) -> CommissionRule:
        rule = await self.get(rule_id)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(rule, field, value)
        await self.db.flush()
        return rule

    async def delete(self, rule_id: uuid.UUID) -> None:
        rule = await self.get(rule_id)
        await self.db.delete(rule)
        await self.db.flush()


# =============================================================================
# Staff target CRUD + progress
# =============================================================================


class StaffTargetService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, payload: StaffTargetCreate) -> StaffTarget:
        user = await self.db.get(User, payload.user_id)
        if user is None:
            raise NotFoundError("User not found.", code="USER_NOT_FOUND")
        clash = await self.db.scalar(
            select(StaffTarget).where(
                StaffTarget.user_id == payload.user_id,
                StaffTarget.period == payload.period,
                StaffTarget.period_start == payload.period_start,
            )
        )
        if clash is not None:
            raise ConflictError(
                "A target for this user and period already exists.",
                code="TARGET_ALREADY_EXISTS",
            )
        target = StaffTarget(**payload.model_dump())
        self.db.add(target)
        await self.db.flush()
        return target

    async def get(self, target_id: uuid.UUID) -> StaffTarget:
        row = await self.db.get(StaffTarget, target_id)
        if row is None:
            raise NotFoundError("Target not found.", code="TARGET_NOT_FOUND")
        return row

    async def list(
        self,
        *,
        user_id: uuid.UUID | None = None,
        period: TargetPeriod | None = None,
        page: int = 1,
        page_size: int = 1000,
    ) -> tuple[list[StaffTarget], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 500)
        base = select(StaffTarget)
        if user_id is not None:
            base = base.where(StaffTarget.user_id == user_id)
        if period is not None:
            base = base.where(StaffTarget.period == period)
        total = await self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = (
            await self.db.scalars(
                base.order_by(StaffTarget.period_start.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    async def update(
        self, target_id: uuid.UUID, payload: StaffTargetUpdate
    ) -> StaffTarget:
        target = await self.get(target_id)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(target, field, value)
        await self.db.flush()
        return target

    async def delete(self, target_id: uuid.UUID) -> None:
        target = await self.get(target_id)
        await self.db.delete(target)
        await self.db.flush()

    async def with_progress(self, target: StaffTarget) -> StaffTargetWithProgress:
        from_d, to_d = _period_bounds(target.period, target.period_start)
        achieved = await self.db.scalar(
            select(func.coalesce(func.sum(Sale.grand_total), 0)).where(
                # Salesperson wins when set, else falls back to the cashier —
                # matches how commission + performance attribute the same bill.
                (
                    (Sale.salesperson_user_id == target.user_id)
                    | (
                        (Sale.salesperson_user_id.is_(None))
                        & (Sale.created_by_user_id == target.user_id)
                    )
                ),
                Sale.status == SaleStatus.COMPLETED,
                func.date(Sale.created_at).between(from_d, to_d),
            )
        )
        achieved_dec = Decimal(str(achieved or 0))
        pct = (
            (achieved_dec / target.target_amount * Decimal("100")).quantize(Decimal("0.01"))
            if target.target_amount > 0
            else _ZERO
        )
        remaining = target.target_amount - achieved_dec
        if remaining < 0:
            remaining = _ZERO
        return StaffTargetWithProgress(
            target=target,  # type: ignore[arg-type]
            achieved_amount=achieved_dec,
            achievement_pct=pct,
            remaining_amount=remaining,
        )


def _period_bounds(period: TargetPeriod, start: date) -> tuple[date, date]:
    """Return (first_day, last_day) for the target's period, both inclusive."""
    if period is TargetPeriod.MONTH:
        # Simple month bounds — assumes period_start is the 1st of a month.
        year, month = start.year, start.month
        if month == 12:
            end = date(year + 1, 1, 1) - _one_day()
        else:
            end = date(year, month + 1, 1) - _one_day()
        return date(year, month, 1), end
    if period is TargetPeriod.QUARTER:
        # 3 calendar months from start.
        year, month = start.year, start.month
        end_month = month + 2
        end_year = year
        while end_month > 12:
            end_month -= 12
            end_year += 1
        if end_month == 12:
            end = date(end_year + 1, 1, 1) - _one_day()
        else:
            end = date(end_year, end_month + 1, 1) - _one_day()
        return date(year, month, 1), end
    if period is TargetPeriod.YEAR:
        return date(start.year, 1, 1), date(start.year, 12, 31)
    raise ValueError(f"Unknown period {period!r}")


def _one_day():
    from datetime import timedelta
    return timedelta(days=1)


# =============================================================================
# Commission calculation
# =============================================================================


class CommissionCalculator:
    """Resolves the best matching rule per sale line, then rolls up per staff."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def calculate(
        self,
        *,
        from_date: date,
        to_date: date,
        user_id: uuid.UUID | None = None,
        include_lines: bool = False,
    ) -> tuple[CommissionRunResult, list[CommissionLine]]:
        # Load every active rule up front — the set is small.
        rules = (
            await self.db.scalars(
                select(CommissionRule).where(CommissionRule.is_active == True)  # noqa: E712
            )
        ).all()

        # Preload sales with lines + variants + parent product for scope matching.
        stmt = (
            select(Sale)
            .where(
                func.date(Sale.created_at).between(from_date, to_date),
                Sale.status == SaleStatus.COMPLETED,
            )
            .options(
                selectinload(Sale.lines).selectinload(SaleLine.variant).selectinload(
                    ProductVariant.product
                )
            )
        )
        if user_id is not None:
            # Attribute to salesperson when set, else the cashier — either match wins.
            stmt = stmt.where(
                (Sale.salesperson_user_id == user_id)
                | (
                    (Sale.salesperson_user_id.is_(None))
                    & (Sale.created_by_user_id == user_id)
                )
            )
        sales = (await self.db.scalars(stmt)).all()

        def _attributed(sale: Sale) -> uuid.UUID | None:
            return sale.salesperson_user_id or sale.created_by_user_id

        # Load user names for the summary payload.
        user_ids = {uid for s in sales if (uid := _attributed(s)) is not None}
        users = {
            u.id: u
            for u in (
                await self.db.scalars(select(User).where(User.id.in_(user_ids)))
            ).all()
        } if user_ids else {}

        per_staff: dict[uuid.UUID, dict] = {}
        lines: list[CommissionLine] = []

        for sale in sales:
            staff_uid = _attributed(sale)
            if staff_uid is None:
                continue
            for sl in sale.lines:
                rule = self._pick_rule(rules, staff_uid, sl, sale.created_at.date())
                amount = self._compute_amount(rule, sl)

                if include_lines:
                    lines.append(
                        CommissionLine(
                            sale_id=sale.id,
                            sale_number=sale.number,
                            sale_line_id=sl.id,
                            variant_id=sl.variant_id,
                            sku=sl.sku,
                            product_name=sl.product_name,
                            quantity=sl.quantity,
                            line_total=sl.line_total,
                            rule_id=rule.id if rule else None,
                            rule_name=rule.name if rule else None,
                            commission_type=rule.commission_type if rule else None,
                            rate=rule.rate if rule else None,
                            commission_amount=amount,
                        )
                    )

                bucket = per_staff.setdefault(
                    staff_uid,
                    {"revenue": _ZERO, "commission": _ZERO, "lines": 0},
                )
                bucket["revenue"] += sl.line_total
                bucket["commission"] += amount
                bucket["lines"] += 1

        summaries: list[StaffCommissionSummary] = []
        grand_total = _ZERO
        for uid, bucket in per_staff.items():
            user = users.get(uid)
            summaries.append(
                StaffCommissionSummary(
                    user_id=uid,
                    user_name=user.full_name if user else "(unknown)",
                    from_date=from_date,
                    to_date=to_date,
                    total_revenue=_round(bucket["revenue"]),
                    total_commission=_round(bucket["commission"]),
                    line_count=bucket["lines"],
                )
            )
            grand_total += bucket["commission"]

        summaries.sort(key=lambda s: s.total_commission, reverse=True)
        return (
            CommissionRunResult(
                from_date=from_date,
                to_date=to_date,
                per_staff=summaries,
                grand_total=_round(grand_total),
            ),
            lines,
        )

    # ------------------------------------------------------------------
    # Rule resolution
    # ------------------------------------------------------------------
    def _pick_rule(
        self,
        rules: list[CommissionRule],
        staff_id: uuid.UUID,
        line: SaleLine,
        on_date: date,
    ) -> CommissionRule | None:
        candidates: list[CommissionRule] = []
        product: Product = line.variant.product
        for r in rules:
            # Staff filter: rule must be for everyone (NULL) or this cashier.
            if r.staff_id is not None and r.staff_id != staff_id:
                continue

            # Effective window.
            if r.effective_from and on_date < r.effective_from:
                continue
            if r.effective_to and on_date > r.effective_to:
                continue

            # Scope match.
            if r.scope is CommissionScope.GLOBAL:
                pass
            elif r.scope is CommissionScope.PRODUCT and r.product_id == product.id:
                pass
            elif r.scope is CommissionScope.CATEGORY and r.category_id == product.category_id:
                pass
            elif r.scope is CommissionScope.BRAND and r.brand_id == product.brand_id:
                pass
            else:
                continue

            candidates.append(r)

        if not candidates:
            return None

        # Sort by (priority DESC, specificity DESC, staff-specific first).
        candidates.sort(
            key=lambda r: (
                r.priority,
                _SPECIFICITY[r.scope],
                1 if r.staff_id is not None else 0,
            ),
            reverse=True,
        )
        return candidates[0]

    def _compute_amount(
        self, rule: CommissionRule | None, line: SaleLine
    ) -> Decimal:
        if rule is None:
            return _ZERO
        if rule.commission_type is CommissionType.PERCENTAGE:
            return _round(line.line_total * (rule.rate / Decimal("100")))
        # FIXED — ₹ per unit sold.
        return _round(rule.rate * line.quantity)
