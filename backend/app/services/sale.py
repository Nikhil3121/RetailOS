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
from sqlalchemy.exc import IntegrityError
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
from app.services.audit import AuditService
from app.services.day_session import DaySessionService
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
        # Idempotency, fast path. A replayed offline bill short-circuits here
        # BEFORE the day-session check, so a sale that already synced can still
        # be acknowledged after the till has been closed for the night.
        #
        # This SELECT is an optimisation, NOT the correctness mechanism - two
        # concurrent requests can both pass it. The UNIQUE constraint on
        # client_uuid is what actually guarantees a single sale; see the
        # IntegrityError handler around the flush below.
        if payload.client_uuid:
            existing = await self.db.scalar(
                select(Sale).where(Sale.client_uuid == payload.client_uuid)
            )
            if existing is not None:
                return await self._acknowledge_replay(existing, payload)

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

        # ---- day session attribution --------------------------------------
        #
        # Two paths, and the difference matters financially.
        #
        # EXPLICIT (offline terminal): the payload names the session that was
        # open when the sale actually happened. That session is used even if it
        # has since closed. It is never silently swapped for whatever is open
        # now - doing so would book last night's takings into today's shift and
        # corrupt the cash reconciliation of both.
        #
        # IMPLICIT (online billing, unchanged): no session supplied, so the
        # store's currently open session is used, exactly as before.
        restating_closed_session = False
        if payload.day_session_id is not None:
            session = await self.db.get(DaySession, payload.day_session_id)
            if session is None:
                raise NotFoundError(
                    "Day session not found.", code="DAY_SESSION_NOT_FOUND"
                )
            # A client must never be able to book a sale against another
            # store's shift, whatever it claims.
            if session.store_id != payload.store_id:
                raise ValidationError(
                    "Day session does not belong to this store.",
                    code="DAY_SESSION_STORE_MISMATCH",
                    details={
                        "day_session_id": str(payload.day_session_id),
                        "store_id": str(payload.store_id),
                    },
                )
            restating_closed_session = session.status is not DayStatus.OPEN
        else:
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
            derived_line_total = _round(gross - disc_amt)

            # ---- offline authoritative line total (Phase 5B) --------------
            # A shelf price is frequently a ROUNDED figure: the label reads
            # MRP 343, 30% off, price 240, but 343 less 30% is 240.10. When a
            # sale is completed offline the customer pays the rounded amount,
            # and re-deriving the line here would record money that never
            # changed hands. The supplied value therefore WINS - but only
            # after it is proved to be a legitimate rounding.
            if item.line_total is not None:
                supplied = _round(item.line_total)
                if supplied > gross:
                    raise ValidationError(
                        "Line total cannot exceed the pre-discount amount.",
                        code="LINE_TOTAL_EXCEEDS_GROSS",
                        details={
                            "line": idx,
                            "line_total": str(supplied),
                            "gross": str(gross),
                        },
                    )
                # A rounding to the whole rupee can move the figure by at most
                # 0.99. Anything larger is not rounding - it is a defect or a
                # tampered client - and is rejected loudly rather than stored.
                if abs(supplied - derived_line_total) >= Decimal("1.00"):
                    raise ValidationError(
                        "Line total is not consistent with unit price and discount.",
                        code="LINE_TOTAL_OUT_OF_RANGE",
                        details={
                            "line": idx,
                            "supplied": str(supplied),
                            "derived": str(derived_line_total),
                        },
                    )
                line_total = supplied
                # The supplied total is preserved EXACTLY. What gets adjusted
                # is the derived discount amount, so that
                # gross - discount == line_total still holds across the bill.
                # discount_pct is stored as the cashier entered it.
                disc_amt = _round(gross - line_total)
            else:
                line_total = derived_line_total
            # Tax-INCLUSIVE pricing (MS Mall + Indian textile convention):
            # unit_price already carries the GST embedded. `line_total` is
            # exactly what the customer pays. `subtotal` is the pre-tax base
            # derived by dividing out (1 + tax_rate/100) — this keeps the tax
            # amount honest for GST filing while showing the customer the
            # printed-on-the-tag price at the counter.
            # ---- historical tax snapshot (Phase 5B) ------------------------
            # An offline bill carries the rate that was in force when it was
            # printed. Without this, editing a product's tax_rate would silently
            # restate the GST on every unsynced bill for that product.
            tax_rate = item.tax_rate if item.tax_rate is not None else product.tax_rate
            divisor = Decimal("1") + tax_rate / Decimal("100")
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
                    tax_rate=tax_rate,
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

        # Stock reservation AND the sale insert run inside one SAVEPOINT.
        #
        # The savepoint is what makes losing the client_uuid race survivable.
        # An outer rollback would undo the right rows, but it also EXPIRES every
        # object in the session - including the authenticated user - and the
        # endpoint still has work to do afterwards (audit logging, response
        # serialisation). The next attribute touch would then try to refresh
        # from the database outside async context and raise MissingGreenlet,
        # turning a handled duplicate into a crashed request.
        #
        # Unwinding only to the savepoint discards this attempt's stock
        # movements and sale row while leaving the session alive and its
        # objects loaded.
        try:
            async with self.db.begin_nested():
                await self._reserve_and_insert(
                    payload=payload,
                    lines=lines,
                    store=store,
                    session=session,
                    inventory=inventory,
                    sale_id=sale_id_placeholder,
                    user_id=user_id,
                    subtotal_net=subtotal_net,
                    discount_total=discount_total,
                    tax_total=tax_total,
                    grand_total=grand_total,
                    paid_total=paid_total,
                    change_due=change_due,
                    balance_due=balance_due,
                )
        except IntegrityError:
            # Another request carrying the same client_uuid committed between
            # our SELECT and our flush. The database - not the earlier read -
            # decides, and it has just told us this sale already exists.
            duplicate = await self.db.scalar(
                select(Sale).where(Sale.client_uuid == payload.client_uuid)
            )
            if duplicate is None:
                # Some other constraint fired. A 409 beats a 500.
                raise ConflictError(
                    "Sale could not be stored due to a conflicting record.",
                    code="SALE_CONFLICT",
                ) from None
            return await self._acknowledge_replay(duplicate, payload)

        # A late-arriving sale changes a shift whose books were already closed.
        # Restate them explicitly and audibly rather than leaving figures that
        # silently no longer match the sales attached to the session.
        if restating_closed_session:
            await self._restate_closed_session(
                session=session,
                sale_id=sale_id_placeholder,
                user_id=user_id,
            )

        return await self.get(sale_id_placeholder)

    async def _restate_closed_session(
        self,
        *,
        session: DaySession,
        sale_id: uuid.UUID,
        user_id: uuid.UUID | None,
    ) -> None:
        """Recompute a closed shift's cash figures after a late sale lands.

        WHAT IS PRESERVED: counted_cash, closed_at and closed_by_user_id are
        untouched. What a human physically counted, and when they signed the
        shift off, are facts and are not rewritten.

        WHAT CHANGES: expected_cash (the till should have held this sale's cash
        too) and therefore cash_diff. Both are recomputed with the same
        arithmetic the original close used.

        WHY IT IS AUDITED: a shift's numbers moving after it was signed off is
        exactly the kind of change that must never happen quietly. The audit row
        records which sale caused it, which session moved, when, and both the
        before and after figures.
        """
        previous_expected = session.expected_cash
        previous_diff = session.cash_diff

        new_expected = await DaySessionService(self.db).recompute_expected_cash(session)
        session.expected_cash = new_expected
        session.cash_diff = (
            session.counted_cash - new_expected
            if session.counted_cash is not None
            else None
        )
        session.restated_at = datetime.now(timezone.utc)

        await AuditService(self.db).log(
            action="day_session.restated",
            entity_type="day_session",
            entity_id=session.id,
            summary=(
                f"Late-arriving offline sale restated closed session "
                f"{session.id}."
            ),
            changes={
                "reason": "late_arriving_offline_sale",
                "caused_by_sale_id": str(sale_id),
                "day_session_id": str(session.id),
                "restated_at": session.restated_at.isoformat(),
                "previous_expected_cash": (
                    str(previous_expected) if previous_expected is not None else None
                ),
                "new_expected_cash": str(new_expected),
                "previous_cash_diff": (
                    str(previous_diff) if previous_diff is not None else None
                ),
                "new_cash_diff": (
                    str(session.cash_diff) if session.cash_diff is not None else None
                ),
                "counted_cash_unchanged": (
                    str(session.counted_cash) if session.counted_cash is not None else None
                ),
            },
        )
        await self.db.flush()

    async def _reserve_and_insert(
        self,
        *,
        payload: SaleCreate,
        lines: list[SaleLine],
        store: Store,
        session: DaySession,
        inventory: InventoryService,
        sale_id: uuid.UUID,
        user_id: uuid.UUID | None,
        subtotal_net: Decimal,
        discount_total: Decimal,
        tax_total: Decimal,
        grand_total: Decimal,
        paid_total: Decimal,
        change_due: Decimal,
        balance_due: Decimal,
    ) -> None:
        """Reserve stock and insert the sale. Always called inside a SAVEPOINT."""
        for line in lines:
            await inventory.post_movement(
                variant_id=line.variant_id,
                store_id=payload.store_id,
                delta=-line.quantity,
                kind=MovementKind.SALE,
                unit_cost=None,
                reference_type="sale",
                reference_id=sale_id,
                reason=None,
                created_by_user_id=user_id,
                allow_negative=True,
            )

        now = datetime.now(timezone.utc)
        # The moment the sale actually happened. For an online bill that is
        # now; for an offline one it is when the cashier rang it up, possibly
        # days ago. It drives the invoice month and is stored for audit.
        occurred_at = payload.occurred_at or now
        number = await self._assign_number(store, occurred_at)

        sale = Sale(
            id=sale_id,
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
            occurred_at=occurred_at,
            terminal_uuid=payload.terminal_uuid,
        )
        sale.lines = lines
        sale.payments = [
            SalePayment(method=p.method, amount=p.amount, reference=p.reference)
            for p in payload.payments
        ]
        self.db.add(sale)
        # The flush is what actually tests uq_sales_client_uuid.
        await self.db.flush()

    async def _acknowledge_replay(self, existing: Sale, payload: SaleCreate) -> Sale:
        """Return an already-stored sale, but only if this really is the same sale.

        A client_uuid is an idempotency key, not a licence to overwrite. If the
        replayed payload describes a DIFFERENT transaction, returning the
        stored one would silently discard whatever the caller actually sent -
        so the mismatch is reported instead of being papered over.
        """
        stored = await self.get(existing.id)
        self._assert_same_transaction(stored, payload)
        return stored

    @staticmethod
    def _assert_same_transaction(stored: Sale, payload: SaleCreate) -> None:
        """Reject a replay whose financial content differs from what was stored.

        Only values the payload actually carries are compared, so a legacy
        online payload (no line_total, no tax_rate) is still recognised as the
        same sale it created.
        """
        stored_lines = sorted(stored.lines, key=lambda line: line.sort_order)

        mismatch: str | None = None
        if len(stored_lines) != len(payload.lines):
            mismatch = "line count"
        else:
            for stored_line, sent in zip(stored_lines, payload.lines):
                if stored_line.variant_id != sent.variant_id:
                    mismatch = "variant"
                elif _round(stored_line.quantity) != _round(sent.quantity):
                    mismatch = "quantity"
                elif sent.line_total is not None and _round(
                    stored_line.line_total
                ) != _round(sent.line_total):
                    mismatch = "line total"
                elif sent.unit_price is not None and _round(
                    stored_line.unit_price
                ) != _round(sent.unit_price):
                    mismatch = "unit price"
                elif _round(stored_line.discount_pct) != _round(sent.discount_pct):
                    mismatch = "discount"
                if mismatch:
                    break

        if mismatch is None:
            sent_paid = _round(sum((p.amount for p in payload.payments), start=_ZERO))
            if _round(stored.paid_total) != sent_paid:
                mismatch = "payment total"

        if mismatch is not None:
            raise ConflictError(
                "This client_uuid was already used for a different sale.",
                code="CLIENT_UUID_PAYLOAD_MISMATCH",
                details={"client_uuid": payload.client_uuid, "differs_on": mismatch},
            )

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
    async def _assign_number(self, store: Store, effective_at: datetime) -> str:
        """Bump the per-(store, month) counter and format INV-CODE-YYYYMM-NNNN.

        The month comes from WHEN THE SALE HAPPENED, not from when it reached
        the server. A bill rung up on 31 March and synced on 1 April belongs to
        the March sequence; giving it an April number would break the
        chronological invoice ordering GST filing depends on.

        Allocation is serialised with SELECT ... FOR UPDATE. Without it two
        concurrent sales read the same next_seq and both claim it - one then
        dies on uq_sales_number, and the bill it belonged to is lost.
        """
        year_month = effective_at.strftime("%Y%m")

        row = await self.db.scalar(
            select(SaleNumberSequence)
            .where(
                SaleNumberSequence.store_id == store.id,
                SaleNumberSequence.year_month == year_month,
            )
            .with_for_update()
        )
        if row is None:
            # A concurrent caller may create the same (store, month) counter
            # first. The SAVEPOINT keeps that collision from destroying the
            # surrounding sale transaction.
            try:
                async with self.db.begin_nested():
                    self.db.add(
                        SaleNumberSequence(
                            store_id=store.id, year_month=year_month, next_seq=1
                        )
                    )
            except IntegrityError:
                pass
            row = await self.db.scalar(
                select(SaleNumberSequence)
                .where(
                    SaleNumberSequence.store_id == store.id,
                    SaleNumberSequence.year_month == year_month,
                )
                .with_for_update()
            )

        seq = row.next_seq
        row.next_seq = seq + 1
        await self.db.flush()
        return f"INV-{store.code}-{year_month}-{seq:04d}"
