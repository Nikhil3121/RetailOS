"""Expense workflow + category CRUD + P&L rollup.

State machine enforcement lives in `ExpenseService` — nothing else in the app
is allowed to flip `Expense.status`. That keeps the transitions auditable and
prevents accidental "approved" flags in tests or scripts.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, NotFoundError
from app.db.models.expense import Expense, ExpenseCategory, ExpenseStatus
from app.db.models.product import ProductVariant
from app.db.models.sale import Sale, SaleLine, SaleStatus
from app.db.models.store import Store
from app.schemas.expense import (
    ExpenseByCategoryRow,
    ExpenseCategoryCreate,
    ExpenseCategoryUpdate,
    ExpenseCreate,
    ExpenseSummary,
    ExpenseTrendPoint,
    ExpenseUpdate,
    PnLReport,
)


_ZERO = Decimal("0.00")
_MONEY = Decimal("0.01")


def _round(v: Decimal) -> Decimal:
    return v.quantize(_MONEY, rounding=ROUND_HALF_UP)


def _dec(v) -> Decimal:
    return Decimal(str(v or 0))


# =============================================================================
# Categories
# =============================================================================


class ExpenseCategoryService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, payload: ExpenseCategoryCreate) -> ExpenseCategory:
        clash = await self.db.scalar(
            select(ExpenseCategory).where(ExpenseCategory.code == payload.code.upper())
        )
        if clash is not None:
            raise ConflictError(
                "A category with this code already exists.", code="EXPENSE_CATEGORY_TAKEN"
            )
        cat = ExpenseCategory(
            code=payload.code.upper(),
            name=payload.name,
            description=payload.description,
            is_active=payload.is_active,
        )
        self.db.add(cat)
        await self.db.flush()
        return cat

    async def get(self, cat_id: uuid.UUID) -> ExpenseCategory:
        row = await self.db.get(ExpenseCategory, cat_id)
        if row is None:
            raise NotFoundError("Expense category not found.", code="EXPENSE_CATEGORY_NOT_FOUND")
        return row

    async def list(
        self,
        *,
        page: int = 1,
        page_size: int = 100,
        is_active: bool | None = None,
    ) -> tuple[list[ExpenseCategory], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 500)
        base = select(ExpenseCategory)
        if is_active is not None:
            base = base.where(ExpenseCategory.is_active == is_active)
        total = await self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = (
            await self.db.scalars(
                base.order_by(ExpenseCategory.name)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    async def update(
        self, cat_id: uuid.UUID, payload: ExpenseCategoryUpdate
    ) -> ExpenseCategory:
        cat = await self.get(cat_id)
        for k, v in payload.model_dump(exclude_unset=True).items():
            setattr(cat, k, v)
        await self.db.flush()
        return cat

    async def delete(self, cat_id: uuid.UUID) -> None:
        cat = await self.get(cat_id)
        await self.db.delete(cat)
        await self.db.flush()


# =============================================================================
# Expenses (CRUD + workflow)
# =============================================================================


class ExpenseService:
    _EDITABLE = {ExpenseStatus.DRAFT, ExpenseStatus.REJECTED}

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Create / read / update / delete
    # ------------------------------------------------------------------
    async def create(
        self, payload: ExpenseCreate, *, user_id: uuid.UUID | None
    ) -> Expense:
        await self._resolve_or_raise(
            ExpenseCategory, payload.category_id, "EXPENSE_CATEGORY_NOT_FOUND", "Category not found."
        )
        if payload.store_id is not None:
            await self._resolve_or_raise(
                Store, payload.store_id, "STORE_NOT_FOUND", "Store not found."
            )

        expense = Expense(
            number=self._generate_number(),
            category_id=payload.category_id,
            store_id=payload.store_id,
            status=ExpenseStatus.DRAFT,
            expense_date=payload.expense_date,
            amount=payload.amount,
            tax_amount=payload.tax_amount,
            payment_method=payload.payment_method,
            vendor=payload.vendor,
            reference=payload.reference,
            receipt_url=str(payload.receipt_url) if payload.receipt_url else None,
            notes=payload.notes,
            created_by_user_id=user_id,
        )
        self.db.add(expense)
        await self.db.flush()

        if payload.submit:
            await self._transition(
                expense,
                to=ExpenseStatus.SUBMITTED,
                user_id=user_id,
            )
        return expense

    async def get(self, expense_id: uuid.UUID) -> Expense:
        stmt = (
            select(Expense)
            .where(Expense.id == expense_id)
            .options(selectinload(Expense.category), selectinload(Expense.store))
        )
        row = await self.db.scalar(stmt)
        if row is None:
            raise NotFoundError("Expense not found.", code="EXPENSE_NOT_FOUND")
        return row

    async def list(
        self,
        *,
        status: ExpenseStatus | None = None,
        store_id: uuid.UUID | None = None,
        category_id: uuid.UUID | None = None,
        from_date: date | None = None,
        to_date: date | None = None,
        page: int = 1,
        page_size: int = 100,
    ) -> tuple[list[Expense], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 500)

        base = select(Expense)
        if status is not None:
            base = base.where(Expense.status == status)
        if store_id is not None:
            base = base.where(Expense.store_id == store_id)
        if category_id is not None:
            base = base.where(Expense.category_id == category_id)
        if from_date is not None:
            base = base.where(Expense.expense_date >= from_date)
        if to_date is not None:
            base = base.where(Expense.expense_date <= to_date)

        total = await self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = (
            await self.db.scalars(
                base.order_by(Expense.expense_date.desc(), Expense.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    async def update(
        self, expense_id: uuid.UUID, payload: ExpenseUpdate
    ) -> Expense:
        expense = await self.get(expense_id)
        if expense.status not in self._EDITABLE:
            raise ConflictError(
                f"Cannot edit an expense in status {expense.status.value}.",
                code="EXPENSE_LOCKED",
            )
        data = payload.model_dump(exclude_unset=True)
        if "category_id" in data and data["category_id"] is not None:
            await self._resolve_or_raise(
                ExpenseCategory, data["category_id"], "EXPENSE_CATEGORY_NOT_FOUND", "Category not found."
            )
        if "store_id" in data and data["store_id"] is not None:
            await self._resolve_or_raise(
                Store, data["store_id"], "STORE_NOT_FOUND", "Store not found."
            )
        if "receipt_url" in data and data["receipt_url"] is not None:
            data["receipt_url"] = str(data["receipt_url"])

        for k, v in data.items():
            setattr(expense, k, v)

        # A REJECTED expense returning through edit lands back in DRAFT so the flow restarts.
        if expense.status is ExpenseStatus.REJECTED:
            expense.status = ExpenseStatus.DRAFT
            expense.reject_reason = None
            expense.rejected_at = None

        await self.db.flush()
        return expense

    async def delete(self, expense_id: uuid.UUID) -> None:
        expense = await self.get(expense_id)
        if expense.status not in self._EDITABLE:
            raise ConflictError(
                "Only DRAFT or REJECTED expenses can be deleted.",
                code="EXPENSE_LOCKED",
            )
        await self.db.delete(expense)
        await self.db.flush()

    # ------------------------------------------------------------------
    # Workflow transitions
    # ------------------------------------------------------------------
    async def submit(self, expense_id: uuid.UUID, *, user_id: uuid.UUID | None) -> Expense:
        expense = await self.get(expense_id)
        return await self._transition(expense, to=ExpenseStatus.SUBMITTED, user_id=user_id)

    async def approve(self, expense_id: uuid.UUID, *, user_id: uuid.UUID | None) -> Expense:
        expense = await self.get(expense_id)
        return await self._transition(expense, to=ExpenseStatus.APPROVED, user_id=user_id)

    async def reject(
        self, expense_id: uuid.UUID, *, reason: str, user_id: uuid.UUID | None
    ) -> Expense:
        expense = await self.get(expense_id)
        return await self._transition(
            expense, to=ExpenseStatus.REJECTED, user_id=user_id, reason=reason
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    async def _transition(
        self,
        expense: Expense,
        *,
        to: ExpenseStatus,
        user_id: uuid.UUID | None,
        reason: str | None = None,
    ) -> Expense:
        legal = {
            ExpenseStatus.DRAFT: {ExpenseStatus.SUBMITTED},
            ExpenseStatus.SUBMITTED: {ExpenseStatus.APPROVED, ExpenseStatus.REJECTED},
            ExpenseStatus.APPROVED: set(),  # terminal
            ExpenseStatus.REJECTED: {ExpenseStatus.SUBMITTED},
        }
        if to not in legal.get(expense.status, set()):
            raise ConflictError(
                f"Cannot move expense from {expense.status.value} to {to.value}.",
                code="EXPENSE_INVALID_TRANSITION",
            )
        now = datetime.now(timezone.utc)
        if to is ExpenseStatus.SUBMITTED:
            expense.status = ExpenseStatus.SUBMITTED
            expense.submitted_by_user_id = user_id
            expense.submitted_at = now
            # Clear prior reject state when re-submitting.
            expense.rejected_at = None
            expense.reject_reason = None
        elif to is ExpenseStatus.APPROVED:
            expense.status = ExpenseStatus.APPROVED
            expense.approved_by_user_id = user_id
            expense.approved_at = now
        elif to is ExpenseStatus.REJECTED:
            expense.status = ExpenseStatus.REJECTED
            expense.rejected_at = now
            expense.reject_reason = reason
        await self.db.flush()
        return expense

    async def _resolve_or_raise(self, model, id_: uuid.UUID, code: str, msg: str) -> None:
        row = await self.db.get(model, id_)
        if row is None:
            raise NotFoundError(msg, code=code)

    def _generate_number(self) -> str:
        # EXP-YYYYMMDD-XXXXXX. Random suffix — expenses don't need strict per-month sequences
        # (unlike sales invoices) because they're accounting-internal, not GST-invoice-facing.
        today = date.today().strftime("%Y%m%d")
        return f"EXP-{today}-{secrets.token_hex(3).upper()}"


# =============================================================================
# Reports — expense rollups + P&L
# =============================================================================


class ExpenseReportService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def summary(
        self,
        *,
        from_date: date,
        to_date: date,
        store_id: uuid.UUID | None = None,
    ) -> ExpenseSummary:
        base_filters = [Expense.expense_date.between(from_date, to_date)]
        if store_id is not None:
            base_filters.append(Expense.store_id == store_id)

        row = (
            await self.db.execute(
                select(
                    func.coalesce(func.sum(case((Expense.status == ExpenseStatus.DRAFT, 1), else_=0)), 0),
                    func.coalesce(func.sum(case((Expense.status == ExpenseStatus.SUBMITTED, 1), else_=0)), 0),
                    func.coalesce(func.sum(case((Expense.status == ExpenseStatus.APPROVED, 1), else_=0)), 0),
                    func.coalesce(func.sum(case((Expense.status == ExpenseStatus.REJECTED, 1), else_=0)), 0),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    Expense.status == ExpenseStatus.SUBMITTED,
                                    Expense.amount + Expense.tax_amount,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    Expense.status == ExpenseStatus.APPROVED,
                                    Expense.amount + Expense.tax_amount,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ),
                ).where(*base_filters)
            )
        ).one()

        return ExpenseSummary(
            from_date=from_date,
            to_date=to_date,
            store_id=store_id,
            draft_count=int(row[0] or 0),
            submitted_count=int(row[1] or 0),
            approved_count=int(row[2] or 0),
            rejected_count=int(row[3] or 0),
            submitted_pending_total=_dec(row[4]),
            approved_total=_dec(row[5]),
        )

    async def by_category(
        self,
        *,
        from_date: date,
        to_date: date,
        store_id: uuid.UUID | None = None,
    ) -> list[ExpenseByCategoryRow]:
        stmt = (
            select(
                ExpenseCategory.id,
                ExpenseCategory.code,
                ExpenseCategory.name,
                func.count(Expense.id).label("cnt"),
                func.coalesce(func.sum(Expense.amount + Expense.tax_amount), 0).label("total"),
            )
            .join(Expense, Expense.category_id == ExpenseCategory.id, isouter=True)
            .where(
                (Expense.id.is_(None))
                | (
                    (Expense.status == ExpenseStatus.APPROVED)
                    & (Expense.expense_date.between(from_date, to_date))
                )
            )
            .group_by(ExpenseCategory.id, ExpenseCategory.code, ExpenseCategory.name)
            .order_by(func.coalesce(func.sum(Expense.amount + Expense.tax_amount), 0).desc())
        )
        if store_id is not None:
            stmt = stmt.where((Expense.id.is_(None)) | (Expense.store_id == store_id))

        rows = (await self.db.execute(stmt)).all()
        return [
            ExpenseByCategoryRow(
                category_id=r.id,
                category_code=r.code,
                category_name=r.name,
                approved_count=int(r.cnt or 0),
                approved_total=_dec(r.total),
            )
            for r in rows
            if int(r.cnt or 0) > 0  # trim zero-activity categories from the report
        ]

    async def trend(
        self,
        *,
        from_date: date,
        to_date: date,
        store_id: uuid.UUID | None = None,
    ) -> list[ExpenseTrendPoint]:
        from datetime import timedelta

        stmt = (
            select(
                Expense.expense_date.label("d"),
                func.count(Expense.id).label("cnt"),
                func.coalesce(func.sum(Expense.amount + Expense.tax_amount), 0).label("total"),
            )
            .where(
                Expense.status == ExpenseStatus.APPROVED,
                Expense.expense_date.between(from_date, to_date),
            )
            .group_by(Expense.expense_date)
            .order_by(Expense.expense_date)
        )
        if store_id is not None:
            stmt = stmt.where(Expense.store_id == store_id)

        by_day: dict[date, tuple[int, Decimal]] = {}
        for r in (await self.db.execute(stmt)).all():
            d = r.d if isinstance(r.d, date) else date.fromisoformat(str(r.d))
            by_day[d] = (int(r.cnt or 0), _dec(r.total))

        out: list[ExpenseTrendPoint] = []
        cur = from_date
        while cur <= to_date:
            cnt, total = by_day.get(cur, (0, _ZERO))
            out.append(ExpenseTrendPoint(day=cur, approved_count=cnt, approved_total=total))
            cur += timedelta(days=1)
        return out

    async def pnl(
        self,
        *,
        from_date: date,
        to_date: date,
        store_id: uuid.UUID | None = None,
    ) -> PnLReport:
        """Revenue − COGS − Operating Expenses = Net Profit.

        Uses variant.cost_price as the COGS proxy (same caveat as the BI
        dashboard); swap in FIFO / weighted-avg accounting to firm this up.
        """
        # Sales side.
        sale_filters = [
            Sale.status == SaleStatus.COMPLETED,
            func.date(Sale.created_at).between(from_date, to_date),
        ]
        if store_id is not None:
            sale_filters.append(Sale.store_id == store_id)

        header = (
            await self.db.execute(
                select(
                    func.coalesce(func.sum(Sale.grand_total), 0),
                    func.coalesce(func.sum(Sale.tax_total), 0),
                    func.coalesce(func.sum(Sale.discount_total), 0),
                    func.coalesce(func.sum(Sale.subtotal), 0),
                ).where(*sale_filters)
            )
        ).one()

        revenue = _dec(header[0])
        tax_collected = _dec(header[1])
        discounts = _dec(header[2])
        net_revenue = _dec(header[3])

        cogs = _dec(
            await self.db.scalar(
                select(func.coalesce(func.sum(SaleLine.quantity * ProductVariant.cost_price), 0))
                .join(Sale, Sale.id == SaleLine.sale_id)
                .join(ProductVariant, ProductVariant.id == SaleLine.variant_id)
                .where(*sale_filters)
            )
        )

        # Expense side.
        exp_filters = [
            Expense.status == ExpenseStatus.APPROVED,
            Expense.expense_date.between(from_date, to_date),
        ]
        if store_id is not None:
            exp_filters.append(Expense.store_id == store_id)

        opex = _dec(
            await self.db.scalar(
                select(func.coalesce(func.sum(Expense.amount + Expense.tax_amount), 0))
                .where(*exp_filters)
            )
        )

        gross_profit = _round(net_revenue - cogs)
        net_profit = _round(gross_profit - opex)
        margin = (
            (net_profit / net_revenue * Decimal("100")).quantize(_MONEY)
            if net_revenue > 0
            else None
        )

        return PnLReport(
            from_date=from_date,
            to_date=to_date,
            store_id=store_id,
            revenue=_round(revenue),
            discounts=_round(discounts),
            tax_collected=_round(tax_collected),
            net_revenue=_round(net_revenue),
            cost_of_goods_sold=_round(cogs),
            gross_profit=gross_profit,
            operating_expenses=_round(opex),
            net_profit=net_profit,
            net_margin_pct=margin,
        )
