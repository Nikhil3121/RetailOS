"""Sale (invoice) service.

Creating a sale:

1. Validates there's an OPEN day session for the store (else refuse).
2. Loads every variant referenced, snapshots its name/SKU/HSN/tax onto the line.
3. Computes line-level subtotal/tax/total from unit_price × qty × (1 - disc%).
4. Sums line totals into the invoice header and validates the payment sum matches.
5. Bumps the (store, month) invoice counter to assign a sequential number.
6. Posts SALE stock movements through the InventoryService in the same tx.

Voiding a completed sale reverses each stock movement via SALE_RETURN.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.db.models.customer import Customer
from app.db.models.day_session import DaySession, DayStatus
from app.db.models.inventory import MovementKind
from app.db.models.product import Product, ProductVariant
from app.db.models.sale import (
    PaymentMethod,
    Sale,
    SaleLine,
    SaleNumberSequence,
    SalePayment,
    SaleStatus,
)
from app.db.models.store import Store
from app.schemas.sale import SaleCreate, SaleSummary
from app.services.inventory import InventoryService


_ZERO = Decimal("0.00")
_MONEY = Decimal("0.01")


def _round(value: Decimal) -> Decimal:
    return value.quantize(_MONEY, rounding=ROUND_HALF_UP)


class SaleService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Create
    # ------------------------------------------------------------------
    async def create(self, payload: SaleCreate, *, user_id: uuid.UUID | None) -> Sale:
        # Idempotency: if the client sent a client_uuid we've already stored
        # (an offline-queued bill replayed after the internet came back), skip
        # the whole insert path and return the existing sale.
        if payload.client_uuid:
            existing = await self.db.scalar(
                select(Sale).where(Sale.client_uuid == payload.client_uuid)
            )
            if existing is not None:
                return await self.get(existing.id)

        store = await self.db.get(Store, payload.store_id)
        if store is None:
            raise NotFoundError("Store not found.", code="STORE_NOT_FOUND")

        if payload.customer_id is not None:
            cust = await self.db.get(Customer, payload.customer_id)
            if cust is None:
                raise NotFoundError("Customer not found.", code="CUSTOMER_NOT_FOUND")

        if payload.salesperson_user_id is not None:
            from app.db.models.user import User

            sp = await self.db.get(User, payload.salesperson_user_id)
            if sp is None:
                raise NotFoundError(
                    "Salesperson not found.", code="SALESPERSON_NOT_FOUND"
                )
            if not sp.is_active:
                raise ValidationError(
                    "Salesperson account is inactive.",
                    code="SALESPERSON_INACTIVE",
                )

        # A sale is always attached to an OPEN session for that store.
        session = await self.db.scalar(
            select(DaySession)
            .where(
                DaySession.store_id == payload.store_id,
                DaySession.status == DayStatus.OPEN,
            )
            .order_by(DaySession.opened_at.desc())
            .limit(1)
        )
        if session is None:
            raise ConflictError(
                "No open day session for this store — open one first.",
                code="NO_OPEN_DAY_SESSION",
            )

        # Load variants + parent products in one shot so we can snapshot every line.
        variant_ids = [line.variant_id for line in payload.lines]
        variants = {
            v.id: v
            for v in (
                await self.db.scalars(
                    select(ProductVariant)
                    .where(ProductVariant.id.in_(variant_ids))
                    .options(selectinload(ProductVariant.product))
                )
            ).all()
        }
        missing = set(variant_ids) - set(variants.keys())
        if missing:
            raise NotFoundError(
                f"Variants not found: {sorted(str(m) for m in missing)}",
                code="VARIANT_NOT_FOUND",
            )

        lines: list[SaleLine] = []
        subtotal_gross = _ZERO  # pre-discount, pre-tax
        subtotal_net = _ZERO    # after discount, pre-tax
        discount_total = _ZERO
        tax_total = _ZERO
        for idx, item in enumerate(payload.lines):
            variant = variants[item.variant_id]
            product: Product = variant.product
            price = item.unit_price if item.unit_price is not None else variant.selling_price
            gross = _round(price * item.quantity)
            disc_amt = _round(gross * (item.discount_pct / Decimal("100")))
            # Tax-INCLUSIVE pricing (MS Mall + Indian textile convention):
            # unit_price already carries the GST embedded. `line_total` is
            # exactly what the customer pays. `subtotal` is the pre-tax base
            # derived by dividing out (1 + tax_rate/100) — this keeps the tax
            # amount honest for GST filing while showing the customer the
            # printed-on-the-tag price at the counter.
            line_total = _round(gross - disc_amt)
            divisor = Decimal("1") + product.tax_rate / Decimal("100")
            net = _round(line_total / divisor) if divisor != 0 else line_total
            tax = _round(line_total - net)

            lines.append(
                SaleLine(
                    variant_id=variant.id,
                    product_name=product.name,
                    variant_name=variant.name,
                    sku=variant.sku,
                    hsn_code=product.hsn_code,
                    quantity=item.quantity,
                    unit_price=price,
                    discount_pct=item.discount_pct,
                    discount_amount=disc_amt,
                    tax_rate=product.tax_rate,
                    subtotal=net,
                    tax_amount=tax,
                    line_total=line_total,
                    sort_order=idx,
                )
            )
            subtotal_gross += gross
            subtotal_net += net
            discount_total += disc_amt
            tax_total += tax

        grand_total = _round(subtotal_net + tax_total)

        paid_total = _round(sum((p.amount for p in payload.payments), start=_ZERO))
        # Under-payment is allowed — the shortfall becomes `balance_due` and the
        # bill can be collected against later via POST /sales/{id}/payments.
        # Over-payment still surfaces as `change_due` (rare but useful for cash).
        if paid_total >= grand_total:
            change_due = _round(paid_total - grand_total)
            balance_due = _ZERO
        else:
            change_due = _ZERO
            balance_due = _round(grand_total - paid_total)

        # Reserve stock before anything else. In a mall billing flow the
        # cashier cannot be blocked at checkout because inventory tracking is
        # behind reality (items picked up before the goods-receipt is posted).
        # We let stock go negative here — the row still appears on Inventory
        # reports so it can be reconciled — instead of failing the sale.
        inventory = InventoryService(self.db)
        sale_id_placeholder = uuid.uuid4()  # links every movement to this sale row
        for line in lines:
            await inventory.post_movement(
                variant_id=line.variant_id,
                store_id=payload.store_id,
                delta=-line.quantity,
                kind=MovementKind.SALE,
                unit_cost=None,
                reference_type="sale",
                reference_id=sale_id_placeholder,
                reason=None,
                created_by_user_id=user_id,
                allow_negative=True,
            )

        number = await self._assign_number(store)
        now = datetime.now(timezone.utc)

        sale = Sale(
            id=sale_id_placeholder,
            number=number,
            store_id=payload.store_id,
            day_session_id=session.id,
            customer_id=payload.customer_id,
            status=SaleStatus.COMPLETED,
            subtotal=_round(subtotal_net),
            discount_total=_round(discount_total),
            tax_total=_round(tax_total),
            grand_total=grand_total,
            paid_total=paid_total,
            change_due=change_due,
            balance_due=balance_due,
            notes=payload.notes,
            completed_at=now,
            created_by_user_id=user_id,
            salesperson_user_id=payload.salesperson_user_id,
            client_uuid=payload.client_uuid,
        )
        sale.lines = lines
        sale.payments = [
            SalePayment(method=p.method, amount=p.amount, reference=p.reference)
            for p in payload.payments
        ]
        self.db.add(sale)
        await self.db.flush()


        return await self.get(sale.id)

    # ------------------------------------------------------------------
    # Read / list / void
    # ------------------------------------------------------------------
    async def get(self, sale_id: uuid.UUID) -> Sale:
        stmt = (
            select(Sale)
            .where(Sale.id == sale_id)
            .options(selectinload(Sale.lines), selectinload(Sale.payments))
        )
        sale = await self.db.scalar(stmt)
        if sale is None:
            raise NotFoundError("Sale not found.", code="SALE_NOT_FOUND")
        return sale

    async def list(
        self,
        *,
        store_id: uuid.UUID | None = None,
        status: SaleStatus | None = None,
        customer_id: uuid.UUID | None = None,
        from_date: date | None = None,
        to_date: date | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[SaleSummary], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 1000)

        base = select(Sale)
        if store_id is not None:
            base = base.where(Sale.store_id == store_id)
        if status is not None:
            base = base.where(Sale.status == status)
        if customer_id is not None:
            base = base.where(Sale.customer_id == customer_id)
        if from_date is not None:
            base = base.where(func.date(Sale.created_at) >= from_date)
        if to_date is not None:
            base = base.where(func.date(Sale.created_at) <= to_date)

        total = await self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = (
            await self.db.scalars(
                base.options(selectinload(Sale.lines))
                .order_by(Sale.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        summaries = [
            SaleSummary(
                id=s.id,
                number=s.number,
                store_id=s.store_id,
                customer_id=s.customer_id,
                salesperson_user_id=s.salesperson_user_id,
                status=s.status,
                grand_total=s.grand_total,
                paid_total=s.paid_total,
                balance_due=s.balance_due,
                line_count=len(s.lines),
                completed_at=s.completed_at,
                created_at=s.created_at,
            )
            for s in rows
        ]
        return summaries, int(total)

    async def add_payment(
        self,
        sale_id: uuid.UUID,
        *,
        method: PaymentMethod,
        amount: Decimal,
        reference: str | None,
        user_id: uuid.UUID | None,
    ) -> Sale:
        """Collect a payment against an already-issued bill.

        Appends a SalePayment row, then recomputes `paid_total` + `balance_due`
        (never lets `balance_due` go negative — any overpayment lands in
        `change_due` and shows up on the printed receipt).
        """
        sale = await self.get(sale_id)
        if sale.status is SaleStatus.VOIDED:
            raise ConflictError(
                "Cannot collect payment on a voided sale.",
                code="SALE_VOIDED",
            )
        amount = _round(amount)
        if amount <= _ZERO:
            raise ValidationError(
                "Payment amount must be greater than zero.",
                code="INVALID_AMOUNT",
            )

        payment = SalePayment(
            sale_id=sale.id,
            method=method,
            amount=amount,
            reference=reference,
        )
        self.db.add(payment)

        new_paid = _round(sale.paid_total + amount)
        if new_paid >= sale.grand_total:
            sale.paid_total = new_paid
            sale.change_due = _round(new_paid - sale.grand_total)
            sale.balance_due = _ZERO
        else:
            sale.paid_total = new_paid
            sale.balance_due = _round(sale.grand_total - new_paid)
            # change_due is a running "cash back this session" figure — a
            # partial collection never adds change, so it stays as-is.
        await self.db.flush()
        # `user_id` is accepted so the endpoint can pass the actor through; the
        # audit trail is written at the endpoint layer, matching other endpoints.
        _ = user_id
        return await self.get(sale.id)

    async def list_outstanding(
        self,
        *,
        store_id: uuid.UUID | None = None,
        customer_id: uuid.UUID | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[SaleSummary], int]:
        """Bills with `balance_due > 0` and status = COMPLETED."""
        page = max(page, 1)
        page_size = min(max(page_size, 1), 1000)

        base = (
            select(Sale)
            .where(Sale.status == SaleStatus.COMPLETED)
            .where(Sale.balance_due > _ZERO)
        )
        if store_id is not None:
            base = base.where(Sale.store_id == store_id)
        if customer_id is not None:
            base = base.where(Sale.customer_id == customer_id)

        total = await self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = (
            await self.db.scalars(
                base.options(selectinload(Sale.lines))
                .order_by(Sale.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        summaries = [
            SaleSummary(
                id=s.id,
                number=s.number,
                store_id=s.store_id,
                customer_id=s.customer_id,
                salesperson_user_id=s.salesperson_user_id,
                status=s.status,
                grand_total=s.grand_total,
                paid_total=s.paid_total,
                balance_due=s.balance_due,
                line_count=len(s.lines),
                completed_at=s.completed_at,
                created_at=s.created_at,
            )
            for s in rows
        ]
        return summaries, int(total)

    async def outstanding_summary(
        self, *, store_id: uuid.UUID | None = None
    ) -> dict[str, str | int]:
        """Aggregate outstanding-dues figures for the billing dashboard."""
        base = (
            select(
                func.count(Sale.id),
                func.coalesce(func.sum(Sale.balance_due), 0),
                func.count(func.distinct(Sale.customer_id)),
            )
            .where(Sale.status == SaleStatus.COMPLETED)
            .where(Sale.balance_due > _ZERO)
        )
        if store_id is not None:
            base = base.where(Sale.store_id == store_id)
        row = (await self.db.execute(base)).one()
        bill_count, total_due, customer_count = row
        return {
            "outstanding_bills": int(bill_count or 0),
            "total_due": str(_round(Decimal(str(total_due or 0)))),
            "customers_with_due": int(customer_count or 0),
        }

    async def void(
        self, sale_id: uuid.UUID, *, reason: str, user_id: uuid.UUID | None
    ) -> Sale:
        sale = await self.get(sale_id)
        if sale.status is SaleStatus.VOIDED:
            raise ConflictError("Sale already voided.", code="SALE_ALREADY_VOIDED")

        inventory = InventoryService(self.db)
        for line in sale.lines:
            await inventory.post_movement(
                variant_id=line.variant_id,
                store_id=sale.store_id,
                delta=line.quantity,  # positive — puts stock back
                kind=MovementKind.SALE_RETURN,
                reference_type="sale_void",
                reference_id=sale.id,
                reason=f"Void {sale.number}: {reason}",
                created_by_user_id=user_id,
                allow_negative=True,  # already-sold stock can safely re-enter
            )

        sale.status = SaleStatus.VOIDED
        sale.voided_at = datetime.now(timezone.utc)
        sale.void_reason = reason
        await self.db.flush()


        return sale

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    async def _assign_number(self, store: Store) -> str:
        """Bump the per-(store, month) counter and format INV-CODE-YYYYMM-NNNN."""
        now = datetime.now(timezone.utc)
        year_month = now.strftime("%Y%m")

        row = await self.db.scalar(
            select(SaleNumberSequence).where(
                SaleNumberSequence.store_id == store.id,
                SaleNumberSequence.year_month == year_month,
            )
        )
        if row is None:
            row = SaleNumberSequence(
                store_id=store.id, year_month=year_month, next_seq=1
            )
            self.db.add(row)
            await self.db.flush()

        seq = row.next_seq
        row.next_seq = seq + 1
        return f"INV-{store.code}-{year_month}-{seq:04d}"
