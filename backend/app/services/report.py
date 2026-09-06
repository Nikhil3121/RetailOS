"""Basic reports — daily summary, top products, daily trend.

Numbers are computed directly from the ledger, uncached, so the values in
these responses always match the source of truth on disk.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ValidationError
from app.db.models.brand import Brand
from app.db.models.category import Category
from app.db.models.day_session import DaySession
from app.db.models.expense import Expense
from app.db.models.product import Product, ProductVariant
from app.db.models.sale import (
    PaymentMethod,
    Sale,
    SaleDocType,
    SaleLine,
    SalePayment,
    SaleStatus,
)
from app.db.models.user import User
from app.schemas.report import (
    DailySalesRow,
    DayBook,
    DayBookEntry,
    ItemProfitReport,
    ItemProfitRow,
    SalesBreakdownRow,
    SalesSummary,
    TopProductRow,
)


_ZERO = Decimal("0.00")


def _dec(v) -> Decimal:
    return Decimal(str(v or 0))


class ReportService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def sales_summary(
        self,
        *,
        from_date: date,
        to_date: date,
        store_id: uuid.UUID | None = None,
    ) -> SalesSummary:
        base = select(Sale).where(
            func.date(Sale.created_at).between(from_date, to_date),
            Sale.status == SaleStatus.COMPLETED,
        )
        if store_id is not None:
            base = base.where(Sale.store_id == store_id)

        header = (
            await self.db.execute(
                select(
                    func.count(Sale.id),
                    func.coalesce(func.sum(Sale.grand_total), 0),
                    func.coalesce(func.sum(Sale.tax_total), 0),
                    func.coalesce(func.sum(Sale.discount_total), 0),
                    func.coalesce(func.sum(Sale.subtotal), 0),
                ).where(
                    func.date(Sale.created_at).between(from_date, to_date),
                    Sale.status == SaleStatus.COMPLETED,
                    *([Sale.store_id == store_id] if store_id is not None else []),
                )
            )
        ).one()

        # Payment split — join into the same date/store filter.
        payments = (
            await self.db.execute(
                select(
                    SalePayment.method,
                    func.coalesce(func.sum(SalePayment.amount), 0),
                )
                .join(Sale, Sale.id == SalePayment.sale_id)
                .where(
                    func.date(Sale.created_at).between(from_date, to_date),
                    Sale.status == SaleStatus.COMPLETED,
                    *([Sale.store_id == store_id] if store_id is not None else []),
                )
                .group_by(SalePayment.method)
            )
        ).all()
        pay_map: dict[PaymentMethod, Decimal] = {m: _dec(t) for m, t in payments}

        return SalesSummary(
            from_date=from_date,
            to_date=to_date,
            sales_count=int(header[0] or 0),
            gross_total=_dec(header[1]),
            tax_total=_dec(header[2]),
            discount_total=_dec(header[3]),
            net_total=_dec(header[4]),
            cash_total=pay_map.get(PaymentMethod.CASH, _ZERO),
            card_total=pay_map.get(PaymentMethod.CARD, _ZERO),
            upi_total=pay_map.get(PaymentMethod.UPI, _ZERO),
            other_total=pay_map.get(PaymentMethod.OTHER, _ZERO),
        )

    async def top_products(
        self,
        *,
        from_date: date,
        to_date: date,
        store_id: uuid.UUID | None = None,
        limit: int = 10,
    ) -> list[TopProductRow]:
        stmt = (
            select(
                SaleLine.variant_id,
                SaleLine.sku,
                SaleLine.product_name,
                func.sum(SaleLine.quantity).label("qty"),
                func.sum(SaleLine.line_total).label("revenue"),
            )
            .join(Sale, Sale.id == SaleLine.sale_id)
            .where(
                func.date(Sale.created_at).between(from_date, to_date),
                Sale.status == SaleStatus.COMPLETED,
            )
            .group_by(SaleLine.variant_id, SaleLine.sku, SaleLine.product_name)
            .order_by(func.sum(SaleLine.line_total).desc())
            .limit(limit)
        )
        if store_id is not None:
            stmt = stmt.where(Sale.store_id == store_id)

        rows = (await self.db.execute(stmt)).all()
        return [
            TopProductRow(
                variant_id=r.variant_id,
                sku=r.sku,
                product_name=r.product_name,
                quantity_sold=_dec(r.qty),
                revenue=_dec(r.revenue),
            )
            for r in rows
        ]

    async def daily_trend(
        self,
        *,
        from_date: date,
        to_date: date,
        store_id: uuid.UUID | None = None,
    ) -> list[DailySalesRow]:
        stmt = (
            select(
                func.date(Sale.created_at).label("day"),
                func.count(Sale.id).label("cnt"),
                func.coalesce(func.sum(Sale.grand_total), 0).label("gross"),
            )
            .where(
                func.date(Sale.created_at).between(from_date, to_date),
                Sale.status == SaleStatus.COMPLETED,
            )
            .group_by(func.date(Sale.created_at))
            .order_by(func.date(Sale.created_at))
        )
        if store_id is not None:
            stmt = stmt.where(Sale.store_id == store_id)

        rows = (await self.db.execute(stmt)).all()
        by_day: dict[date, tuple[int, Decimal]] = {}
        for r in rows:
            d = r.day if isinstance(r.day, date) else date.fromisoformat(str(r.day))
            by_day[d] = (int(r.cnt or 0), _dec(r.gross))

        out: list[DailySalesRow] = []
        current = from_date
        while current <= to_date:
            cnt, gross = by_day.get(current, (0, _ZERO))
            out.append(DailySalesRow(day=current, sales_count=cnt, gross_total=gross))
            current += timedelta(days=1)
        return out

    # ------------------------------------------------------------------
    # Sales broken down by a dimension
    # ------------------------------------------------------------------
    async def sales_breakdown(
        self,
        *,
        dimension: str,
        from_date: date,
        to_date: date,
        store_id: uuid.UUID | None = None,
        limit: int = 100,
    ) -> list[SalesBreakdownRow]:
        """Takings sliced by brand, category, size, or salesperson.

        ONE FUNCTION FOR FOUR REPORTS, deliberately. They are the same question
        asked of four different columns; four near-identical endpoints would
        drift apart inside a month, and the shop would end up with a by-brand
        figure that does not reconcile with the by-category one.

        WHAT IS JOINED, AND WHAT IS NOT
        Brand and category come from the PRODUCT, which means they follow the
        catalogue as it stands today. That is the right reading for these two:
        a manager asking how a brand did in March means the brand as it is now
        grouped, not as it happened to be labelled then.

        Size and salesperson come from the SALE LINE's own snapshot, because
        those are facts about the transaction. Re-reading them would change who
        earned a commission after the fact.
        """
        if dimension == "brand":
            key_col, label_col = Brand.id, Brand.name
            stmt = (
                select(
                    key_col.label("key_id"),
                    label_col.label("label"),
                    func.sum(SaleLine.quantity).label("qty"),
                    func.sum(SaleLine.line_total).label("revenue"),
                )
                .select_from(SaleLine)
                .join(Sale, Sale.id == SaleLine.sale_id)
                .join(ProductVariant, ProductVariant.id == SaleLine.variant_id)
                .join(Product, Product.id == ProductVariant.product_id)
                .join(Brand, Brand.id == Product.brand_id, isouter=True)
                .group_by(key_col, label_col)
            )
        elif dimension == "category":
            key_col, label_col = Category.id, Category.name
            stmt = (
                select(
                    key_col.label("key_id"),
                    label_col.label("label"),
                    func.sum(SaleLine.quantity).label("qty"),
                    func.sum(SaleLine.line_total).label("revenue"),
                )
                .select_from(SaleLine)
                .join(Sale, Sale.id == SaleLine.sale_id)
                .join(ProductVariant, ProductVariant.id == SaleLine.variant_id)
                .join(Product, Product.id == ProductVariant.product_id)
                .join(Category, Category.id == Product.category_id, isouter=True)
                .group_by(key_col, label_col)
            )
        elif dimension == "size":
            # The variant NAME is the size in this shop — M, XL, 38. Read off
            # the line's own snapshot so renaming a variant later cannot
            # restate a month that has already been reported.
            stmt = (
                select(
                    literal(None).label("key_id"),
                    SaleLine.variant_name.label("label"),
                    func.sum(SaleLine.quantity).label("qty"),
                    func.sum(SaleLine.line_total).label("revenue"),
                )
                .select_from(SaleLine)
                .join(Sale, Sale.id == SaleLine.sale_id)
                .group_by(SaleLine.variant_name)
            )
        elif dimension == "salesperson":
            # THE LINE's salesperson, falling back to the BILL's. Two staff
            # routinely split one bill in a garment shop, and crediting the
            # whole thing to whoever was selected last sends the commission to
            # the wrong person.
            who = func.coalesce(SaleLine.salesperson_user_id, Sale.salesperson_user_id)
            stmt = (
                select(
                    who.label("key_id"),
                    func.coalesce(User.full_name, literal("Unattributed")).label("label"),
                    func.sum(SaleLine.quantity).label("qty"),
                    func.sum(SaleLine.line_total).label("revenue"),
                )
                .select_from(SaleLine)
                .join(Sale, Sale.id == SaleLine.sale_id)
                .join(User, User.id == who, isouter=True)
                .group_by(who, User.full_name)
            )
        else:
            raise ValidationError(
                "Unknown breakdown. Use brand, category, size or salesperson.",
                code="UNKNOWN_BREAKDOWN",
                details={"dimension": dimension},
            )

        stmt = stmt.where(
            func.date(Sale.created_at).between(from_date, to_date),
            Sale.status == SaleStatus.COMPLETED,
        )
        if store_id is not None:
            stmt = stmt.where(Sale.store_id == store_id)
        stmt = stmt.order_by(func.sum(SaleLine.line_total).desc()).limit(limit)

        rows = (await self.db.execute(stmt)).all()

        # The share is computed over the rows RETURNED, and the limit is high
        # enough that this is the whole period in practice. Computed here
        # rather than on the screen so an export and the display agree to the
        # paisa.
        total = sum((_dec(r.revenue) for r in rows), start=_ZERO)
        out: list[SalesBreakdownRow] = []
        for r in rows:
            revenue = _dec(r.revenue)
            out.append(
                SalesBreakdownRow(
                    key_id=r.key_id,
                    # Never blank. A product with no brand is a real and common
                    # case, and an unlabelled row in a report is one nobody can
                    # act on — say which bucket it is.
                    label=r.label or "Unassigned",
                    quantity_sold=_dec(r.qty),
                    revenue=revenue,
                    share_pct=(
                        (revenue / total * Decimal("100")).quantize(Decimal("0.01"))
                        if total
                        else _ZERO
                    ),
                )
            )
        return out

    # ------------------------------------------------------------------
    # Item-wise profit
    # ------------------------------------------------------------------
    async def item_profit(
        self,
        *,
        from_date: date,
        to_date: date,
        store_id: uuid.UUID | None = None,
        limit: int = 200,
    ) -> ItemProfitReport:
        """Revenue minus the cost SNAPSHOTTED on each line.

        Never today's cost price. Re-reading the catalogue would re-price every
        historical bill whenever a supplier changes their rate, so running the
        same March report in April would show a different margin with nothing
        to explain the move.

        LINES WITH NO COST ARE COUNTED, NOT HIDDEN
        Bills written before costs were snapshotted carry none, and there is no
        honest way to invent one. Costing them at zero would report their whole
        revenue as profit — the most flattering possible lie. Dropping them
        silently would understate the period. So they are excluded from the
        margin AND reported as a figure the screen has to show.
        """
        filters = [
            func.date(Sale.created_at).between(from_date, to_date),
            Sale.status == SaleStatus.COMPLETED,
        ]
        if store_id is not None:
            filters.append(Sale.store_id == store_id)

        # The hole, measured first: how much of this period cannot be costed.
        gap = (
            await self.db.execute(
                select(
                    func.count(SaleLine.id),
                    func.coalesce(func.sum(SaleLine.line_total), 0),
                )
                .select_from(SaleLine)
                .join(Sale, Sale.id == SaleLine.sale_id)
                .where(*filters, SaleLine.unit_cost.is_(None))
            )
        ).one()

        cost_expr = func.sum(SaleLine.unit_cost * SaleLine.quantity)
        stmt = (
            select(
                SaleLine.variant_id,
                SaleLine.sku,
                SaleLine.product_name,
                SaleLine.variant_name,
                func.sum(SaleLine.quantity).label("qty"),
                func.sum(SaleLine.line_total).label("revenue"),
                cost_expr.label("cost"),
            )
            .select_from(SaleLine)
            .join(Sale, Sale.id == SaleLine.sale_id)
            .where(*filters, SaleLine.unit_cost.is_not(None))
            .group_by(
                SaleLine.variant_id,
                SaleLine.sku,
                SaleLine.product_name,
                SaleLine.variant_name,
            )
            # Ordered by PROFIT, not revenue. The best-selling item and the
            # most profitable one are routinely different, and the second is
            # the question this report exists to answer.
            .order_by((func.sum(SaleLine.line_total) - cost_expr).desc())
            .limit(limit)
        )

        rows = (await self.db.execute(stmt)).all()
        out: list[ItemProfitRow] = []
        total_revenue = _ZERO
        total_cost = _ZERO
        for r in rows:
            revenue = _dec(r.revenue)
            cost = _dec(r.cost)
            profit = revenue - cost
            total_revenue += revenue
            total_cost += cost
            out.append(
                ItemProfitRow(
                    variant_id=r.variant_id,
                    sku=r.sku,
                    product_name=r.product_name,
                    variant_name=r.variant_name,
                    quantity_sold=_dec(r.qty),
                    revenue=revenue,
                    cost=cost,
                    profit=profit,
                    margin_pct=(
                        (profit / revenue * Decimal("100")).quantize(Decimal("0.01"))
                        if revenue
                        else None
                    ),
                )
            )

        return ItemProfitReport(
            from_date=from_date,
            to_date=to_date,
            rows=out,
            total_revenue=total_revenue,
            total_cost=total_cost,
            total_profit=total_revenue - total_cost,
            uncosted_lines=int(gap[0] or 0),
            uncosted_revenue=_dec(gap[1]),
        )

    # ------------------------------------------------------------------
    # Day book
    # ------------------------------------------------------------------
    async def day_book(
        self,
        *,
        day: date,
        store_id: uuid.UUID | None = None,
    ) -> DayBook:
        """Everything that moved money on one day, at one branch.

        The report an owner actually opens at closing time. Not "what did we
        sell" — that is the sales summary — but "what should be in the drawer,
        and does it match".

        CASH IS TRACKED SEPARATELY FROM THE TOTAL, THROUGHOUT
        The drawer only ever holds cash. A day of card sales inflates takings
        and changes the drawer by nothing, and a day book that mixes the two
        cannot answer the one question it exists for. Every entry carries its
        method, and the cash columns are summed from those alone.

        SIGNED AMOUNTS
        Money in is positive, money out negative. A day book that printed both
        as positive would need a legend to be read at all — and the one thing
        this report cannot afford is to be misread at the end of a long day.
        """
        entries: list[DayBookEntry] = []
        sales_total = _ZERO
        returns_total = _ZERO
        collections_total = _ZERO
        expenses_total = _ZERO
        cash_in = _ZERO
        cash_out = _ZERO

        store_filter = [Sale.store_id == store_id] if store_id is not None else []

        # ---- bills, and the money taken against them --------------------
        #
        # Payments are read rather than grand totals, because a credit sale
        # moves goods and NO money: it belongs in the day's sales but not in
        # the drawer. Reading grand_total would put money in the book that
        # nobody ever handed over.
        payments = (
            await self.db.execute(
                select(Sale, SalePayment)
                .join(SalePayment, SalePayment.sale_id == Sale.id)
                .where(
                    func.date(Sale.created_at) == day,
                    Sale.status == SaleStatus.COMPLETED,
                    *store_filter,
                )
                .options(selectinload(Sale.customer))
                .order_by(SalePayment.created_at)
            )
        ).all()

        for sale, payment in payments:
            amount = _dec(payment.amount)
            is_return = sale.doc_type == SaleDocType.RETURN
            # A credit note's payment is money going OUT of the drawer, and its
            # stored amount is already negative. Normalised here so the sign in
            # the book always means direction, never storage convention.
            signed = -abs(amount) if is_return else abs(amount)
            method = (
                payment.method.value
                if hasattr(payment.method, "value")
                else str(payment.method)
            )
            entries.append(
                DayBookEntry(
                    at=payment.created_at,
                    kind="return" if is_return else "sale",
                    reference=sale.number,
                    party=sale.customer.name if sale.customer else None,
                    method=method,
                    amount=signed,
                )
            )
            if is_return:
                returns_total += abs(amount)
            else:
                sales_total += abs(amount)
            if method == PaymentMethod.CASH.value:
                if signed >= 0:
                    cash_in += signed
                else:
                    cash_out += -signed

        # ---- expenses paid out ------------------------------------------
        expense_filter = [Expense.store_id == store_id] if store_id is not None else []
        expenses = (
            await self.db.execute(
                select(Expense)
                .where(Expense.expense_date == day, *expense_filter)
                .options(selectinload(Expense.category))
                .order_by(Expense.created_at)
            )
        ).scalars().all()

        for expense in expenses:
            amount = _dec(expense.amount) + _dec(expense.tax_amount)
            entries.append(
                DayBookEntry(
                    at=expense.created_at,
                    kind="expense",
                    reference=expense.category.name if expense.category else "Expense",
                    party=getattr(expense, "paid_to", None),
                    method=expense.payment_method,
                    # Always out. An expense is money leaving the business, and
                    # the sign says so without anyone having to know what kind
                    # of row this is.
                    amount=-amount,
                )
            )
            expenses_total += amount
            if expense.payment_method == PaymentMethod.CASH.value:
                cash_out += amount

        entries.sort(key=lambda e: e.at)

        # ---- the drawer --------------------------------------------------
        #
        # Opening cash comes from the day session. NULL when none was opened —
        # a real situation on a till that has never done a formal open, and
        # different from "opened with zero". Without it there is no expected
        # figure to compare a count against, and inventing one would let a
        # short drawer look balanced.
        opening_cash: Decimal | None = None
        if store_id is not None:
            session = await self.db.scalar(
                select(DaySession)
                .where(
                    DaySession.store_id == store_id,
                    func.date(DaySession.opened_at) == day,
                )
                .order_by(DaySession.opened_at.desc())
            )
            if session is not None:
                opening_cash = _dec(session.opening_cash)

        return DayBook(
            day=day,
            store_id=store_id,
            entries=entries,
            opening_cash=opening_cash,
            sales_total=sales_total,
            returns_total=returns_total,
            collections_total=collections_total,
            expenses_total=expenses_total,
            net_total=sales_total - returns_total - expenses_total,
            cash_in=cash_in,
            cash_out=cash_out,
            expected_cash=(
                opening_cash + cash_in - cash_out if opening_cash is not None else None
            ),
        )
