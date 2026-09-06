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
from app.db.models.bundle import ProductBundleItem
from app.db.models.customer import Customer
from app.db.models.day_session import DaySession, DayStatus
from app.db.models.inventory import MovementKind
from app.db.models.product import Product, ProductVariant
from app.db.models.sale import (
    PaymentMethod,
    Sale,
    SaleDocType,
    SaleLine,
    SaleNumberSequence,
    SalePayment,
    SaleStatus,
)
from app.db.models.store import Store
from app.schemas.sale import (
    AdvanceCreate,
    CustomerBalance,
    SaleCreate,
    SaleLineReturnable,
    SaleReturnCreate,
    SaleSummary,
)
from app.services.audit import AuditService
from app.services.coupon import CouponService
from app.services.day_session import DaySessionService
from app.services.inventory import InventoryService
from app.services.loyalty import LoyaltyService
from app.services.reward import RewardService
from app.services.price_list import PriceListService


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

        # THE RATE FOR THIS CUSTOMER, resolved once for the whole cart.
        #
        # Wholesale, retail and dealer customers pay different prices for the
        # same item. This is the single place a selling rate is chosen; the
        # /price-lists/resolve endpoint the billing screen calls runs the SAME
        # function, so the price on screen and the price written to the bill
        # cannot diverge. A line that supplies its own unit_price still wins —
        # a negotiated rate at the counter overrides the card.
        resolved = await PriceListService(self.db).resolve(
            variant_ids=variant_ids, customer_id=payload.customer_id
        )

        lines: list[SaleLine] = []
        subtotal_gross = _ZERO  # pre-discount, pre-tax
        subtotal_net = _ZERO    # after discount, pre-tax
        discount_total = _ZERO
        tax_total = _ZERO
        for idx, item in enumerate(payload.lines):
            variant = variants[item.variant_id]
            product: Product = variant.product
            listed = resolved.get(item.variant_id)
            price = (
                item.unit_price
                if item.unit_price is not None
                else (listed.price if listed else variant.selling_price)
            )
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
                    # Snapshot alongside the price it is compared against.
                    mrp=variant.mrp,
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

        gross_total = _round(subtotal_net + tax_total)

        # ---- money off the whole bill --------------------------------------
        #
        # Applied AFTER the lines are totalled and deliberately NOT spread
        # across them: allocating it would change each line's taxable value and
        # therefore its GST, which is a tax decision and not one a discount box
        # should be making. The per-line tax computed above stands untouched.
        #
        # Clamped to the bill: a discount larger than the total would produce a
        # negative sale, which reads downstream as a return.
        bill_discount = _round(payload.bill_discount or _ZERO)
        if bill_discount < _ZERO:
            raise ValidationError(
                "A bill discount cannot be negative.", code="BILL_DISCOUNT_NEGATIVE"
            )
        if bill_discount > gross_total:
            raise ValidationError(
                "The discount is more than the bill.",
                code="BILL_DISCOUNT_EXCEEDS_TOTAL",
                details={"bill": str(gross_total), "discount": str(bill_discount)},
            )

        after_discount = _round(gross_total - bill_discount)

        # ---- round off ------------------------------------------------------
        #
        # To the whole rupee, which is the convention on a GST invoice and the
        # only amount a cash drawer can actually make. Stored as its own signed
        # figure so the bill still adds up on paper.
        round_off = _ZERO
        if payload.round_off_enabled:
            rounded = after_discount.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
            round_off = _round(rounded - after_discount)

        grand_total = _round(after_discount + round_off)

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

        # ---- credit limit ----------------------------------------------------
        #
        # Checked against the customer's TOTAL outstanding, not just this bill.
        # A limit that only looked at the bill in hand would let someone run up
        # any amount one small credit sale at a time, which is precisely the
        # failure a limit exists to prevent.
        if balance_due > _ZERO and payload.customer_id is not None:
            await self._assert_within_credit_limit(
                customer_id=payload.customer_id, adding=balance_due
            )

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
                    bill_discount=bill_discount,
                    bill_discount_reason=payload.bill_discount_reason,
                    round_off=round_off,
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

        # ---- coupon --------------------------------------------------------
        #
        # RE-VALIDATED server-side rather than trusted. The client sends which
        # coupon and how much it took off; the server recomputes the discount
        # from the coupon's own rules and refuses if they disagree. Otherwise
        # naming any coupon would let a modified request set any discount.
        if payload.coupon_id is not None:
            from app.schemas.coupon import CouponValidateRequest

            coupons = CouponService(self.db)
            coupon = await coupons.get(payload.coupon_id)
            check = await coupons.validate(
                CouponValidateRequest(
                    code=coupon.code,
                    bill_amount=gross_total,
                    customer_id=payload.customer_id,
                )
            )
            if not check.valid:
                raise ValidationError(
                    check.reason or "That coupon cannot be used on this bill.",
                    code="COUPON_INVALID",
                )
            if check.computed_discount != bill_discount:
                raise ValidationError(
                    "The coupon discount does not match the bill.",
                    code="COUPON_DISCOUNT_MISMATCH",
                    details={
                        "expected": str(check.computed_discount),
                        "supplied": str(bill_discount),
                    },
                )

            sale_row = await self.get(sale_id_placeholder)
            sale_row.coupon_id = coupon.id
            sale_row.coupon_code = coupon.code
            await coupons.apply_to_sale(
                coupon.id, sale=sale_row, discount_amount=bill_discount
            )

        # ---- reward points ---------------------------------------------------
        #
        # AFTER the sale is safely stored, and only for a named customer — a
        # walk-in has no account to credit. Earning is deliberately not inside
        # the savepoint above: the bill is the thing that must not be lost, and
        # a loyalty problem must never be able to fail a sale that has already
        # taken the customer's money.
        if payload.customer_id is not None:
            await LoyaltyService(self.db).earn_for_sale(
                customer_id=payload.customer_id,
                sale_id=sale_id_placeholder,
                amount=grand_total,
                user_id=user_id,
            )

        return await self.get(sale_id_placeholder)

    async def _assert_within_credit_limit(
        self, *, customer_id: uuid.UUID, adding: Decimal
    ) -> None:
        """Refuse a credit sale that would take the customer over their limit.

        Enforced here rather than by a database constraint: the rule spans every
        open bill this customer has, which no CHECK can express, and the answer
        has to be a sentence a cashier can act on.
        """
        customer = await self.db.get(Customer, customer_id)
        if customer is None or customer.credit_limit is None:
            return  # no limit set — the default for every existing customer

        # Only COMPLETED sales count. A voided bill is not money owed, and a
        # credit note carries a negative balance that correctly reduces the total.
        outstanding = await self.db.scalar(
            select(func.coalesce(func.sum(Sale.balance_due), 0)).where(
                Sale.customer_id == customer_id,
                Sale.status == SaleStatus.COMPLETED,
            )
        )
        current = Decimal(str(outstanding or 0))
        after = current + adding
        if after > customer.credit_limit:
            raise ValidationError(
                f"{customer.name} would owe {after} against a credit limit of "
                f"{customer.credit_limit}. They already owe {current}. "
                f"Collect payment or raise the limit before selling on credit.",
                code="CREDIT_LIMIT_EXCEEDED",
                details={
                    "customer_id": str(customer_id),
                    "credit_limit": str(customer.credit_limit),
                    "already_owed": str(current),
                    "this_bill": str(adding),
                },
            )

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
        bill_discount: Decimal = _ZERO,
        bill_discount_reason: str | None = None,
        round_off: Decimal = _ZERO,
    ) -> None:
        """Reserve stock and insert the sale. Always called inside a SAVEPOINT."""
        # A BUNDLE TAKES ITS COMPONENTS OUT OF STOCK, NOT ITSELF.
        #
        # A "saree + blouse" combo is a way of selling, not a thing on a shelf.
        # Decrementing the bundle variant as well would count the same physical
        # garment twice — once as the combo and once as the saree.
        recipes = await self._bundle_recipes([l.variant_id for l in lines])

        for line in lines:
            recipe = recipes.get(line.variant_id)
            if recipe:
                for component_id, per_bundle in recipe:
                    await inventory.post_movement(
                        variant_id=component_id,
                        store_id=payload.store_id,
                        delta=-(line.quantity * per_bundle),
                        kind=MovementKind.SALE,
                        unit_cost=None,
                        reference_type="sale",
                        reference_id=sale_id,
                        reason=f"Bundle {line.sku}",
                        created_by_user_id=user_id,
                        allow_negative=True,
                    )
                continue

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
            bill_discount=bill_discount,
            bill_discount_reason=payload.bill_discount_reason,
            round_off=round_off,
            notes=payload.notes,
            completed_at=now,
            created_by_user_id=user_id,
            salesperson_user_id=payload.salesperson_user_id,
            client_uuid=payload.client_uuid,
            occurred_at=occurred_at,
            terminal_uuid=payload.terminal_uuid,
        )
        # ---- gift scheme --------------------------------------------------
        #
        # Decided by the SAME function the billing screen calls to show
        # "₹180 more for a steel glass". If the two used different logic a
        # customer could be promised a bottle on screen and not get one on the
        # bill, which is the worst thing this feature could do.
        #
        # The label is COPIED onto the sale rather than joined, so renaming or
        # deleting the scheme later cannot change what a printed bill says the
        # customer was handed.
        outcome = await RewardService(self.db).evaluate(
            store_id=payload.store_id,
            amount=grand_total,
            on_day=occurred_at.date(),
        )
        if outcome.earned is not None:
            sale.reward_scheme_id = outcome.earned.id
            sale.reward_label = outcome.earned.gift_label

        sale.lines = lines
        sale.payments = [
            SalePayment(method=p.method, amount=p.amount, reference=p.reference)
            for p in payload.payments
        ]
        self.db.add(sale)
        # The flush is what actually tests uq_sales_client_uuid.
        await self.db.flush()

    async def _bundle_recipes(
        self, variant_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[tuple[uuid.UUID, Decimal]]]:
        """Component list for any of these variants that is a bundle.

        One query for the whole cart. A variant absent from the result is an
        ordinary product and moves its own stock.
        """
        if not variant_ids:
            return {}
        rows = await self.db.execute(
            select(
                ProductBundleItem.bundle_variant_id,
                ProductBundleItem.component_variant_id,
                ProductBundleItem.quantity,
            ).where(ProductBundleItem.bundle_variant_id.in_(variant_ids))
        )
        out: dict[uuid.UUID, list[tuple[uuid.UUID, Decimal]]] = {}
        for bundle_id, component_id, qty in rows.all():
            out.setdefault(bundle_id, []).append((component_id, Decimal(str(qty))))
        return out

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

        # Take back any points this bill earned. Without it a customer could
        # buy, collect points, have the bill voided, and keep them — the shop
        # would have paid for a transaction that never happened.
        await LoyaltyService(self.db).reverse_for_sale(
            sale_id=sale.id,
            reason=f"Void {sale.number}: {reason}",
            user_id=user_id,
        )

        return sale

    # ------------------------------------------------------------------
    # Returns / credit notes
    # ------------------------------------------------------------------
    async def returnable_lines(self, sale_id: uuid.UUID) -> list[SaleLineReturnable]:
        """How much of each line on this invoice can still be credited.

        Drives the return screen: a cashier picks from what is actually left,
        rather than typing a quantity that is rejected on save.
        """
        sale = await self.get(sale_id)
        already = await self._returned_quantities(sale_id)
        out: list[SaleLineReturnable] = []
        for line in sorted(sale.lines, key=lambda l: l.sort_order):
            done = already.get(line.id, _ZERO)
            out.append(
                SaleLineReturnable(
                    sale_line_id=line.id,
                    variant_id=line.variant_id,
                    product_name=line.product_name,
                    variant_name=line.variant_name,
                    sku=line.sku,
                    unit_price=line.unit_price,
                    sold_quantity=line.quantity,
                    returned_quantity=done,
                    returnable_quantity=line.quantity - done,
                )
            )
        return out

    async def create_return(
        self,
        original_sale_id: uuid.UUID,
        payload: SaleReturnCreate,
        *,
        user_id: uuid.UUID | None,
    ) -> Sale:
        """Credit part or all of an invoice.

        The credit note is a `sales` row with doc_type=RETURN and NEGATIVE money,
        so every existing aggregate nets it out without modification. See
        migration 0016 for why the sign lives in storage.

        NOTHING about price, discount or tax is taken from the caller. Every
        figure is copied from the original line and scaled by the returned
        quantity, so a credit note cannot disagree with the invoice it reverses.
        """
        original = await self.get(original_sale_id)

        if original.doc_type is SaleDocType.RETURN:
            raise ValidationError(
                "A credit note cannot itself be returned.",
                code="RETURN_OF_RETURN",
            )
        if original.status is SaleStatus.VOIDED:
            raise ValidationError(
                "This bill was voided — its stock and money are already reversed.",
                code="RETURN_OF_VOIDED_SALE",
            )

        # ---- how much is genuinely left to credit --------------------------
        by_id = {line.id: line for line in original.lines}
        already = await self._returned_quantities(original_sale_id)

        requested: dict[uuid.UUID, Decimal] = {}
        for item in payload.lines:
            line = by_id.get(item.sale_line_id)
            if line is None:
                raise ValidationError(
                    "That line is not on this bill.",
                    code="RETURN_LINE_NOT_ON_SALE",
                )
            # Two entries for the same line must be summed before the cap is
            # checked, or a caller can split one over-return across rows.
            requested[line.id] = requested.get(line.id, _ZERO) + item.quantity

        for line_id, qty in requested.items():
            line = by_id[line_id]
            remaining = line.quantity - already.get(line_id, _ZERO)
            if qty > remaining:
                raise ValidationError(
                    f"Only {remaining} of {line.product_name} can still be returned "
                    f"({line.quantity} sold, {already.get(line_id, _ZERO)} already credited).",
                    code="RETURN_QUANTITY_EXCEEDS_SOLD",
                )

        # ---- attribution: same rules as a sale ------------------------------
        store = await self.db.get(Store, original.store_id)
        if store is None:
            raise NotFoundError("Store not found.", code="STORE_NOT_FOUND")

        session, restating = await self._resolve_session_for(
            store_id=original.store_id, day_session_id=payload.day_session_id
        )

        occurred_at = payload.occurred_at or datetime.now(timezone.utc)

        # ---- build the negative lines ---------------------------------------
        lines: list[SaleLine] = []
        subtotal_net = _ZERO
        discount_total = _ZERO
        tax_total = _ZERO

        for idx, (line_id, qty) in enumerate(requested.items()):
            src = by_id[line_id]
            # Scale each stored figure by the proportion coming back. Copying
            # and scaling — rather than recomputing from unit_price — is what
            # guarantees a full return sums to exactly the original amounts,
            # including whatever rounding the original line carried.
            share = qty / src.quantity
            net = _round(src.subtotal * share)
            tax = _round(src.tax_amount * share)
            disc = _round(src.discount_amount * share)
            total = _round(src.line_total * share)

            lines.append(
                SaleLine(
                    variant_id=src.variant_id,
                    product_name=src.product_name,
                    variant_name=src.variant_name,
                    sku=src.sku,
                    hsn_code=src.hsn_code,
                    quantity=-qty,
                    unit_price=src.unit_price,
                    discount_pct=src.discount_pct,
                    discount_amount=-disc,
                    tax_rate=src.tax_rate,
                    subtotal=-net,
                    tax_amount=-tax,
                    line_total=-total,
                    sort_order=idx,
                )
            )
            subtotal_net += net
            discount_total += disc
            tax_total += tax

        grand_total = _round(subtotal_net + tax_total)
        refunded = _round(sum((r.amount for r in payload.refunds), start=_ZERO))
        if refunded > grand_total:
            raise ValidationError(
                f"Refund of {refunded} exceeds the credit note value of {grand_total}.",
                code="REFUND_EXCEEDS_CREDIT",
            )

        number = await self._assign_number(
            store, occurred_at, doc_type=SaleDocType.RETURN
        )

        credit = Sale(
            number=number,
            client_uuid=payload.client_uuid,
            occurred_at=occurred_at,
            terminal_uuid=payload.terminal_uuid,
            store_id=original.store_id,
            day_session_id=session.id,
            customer_id=original.customer_id,
            status=SaleStatus.COMPLETED,
            doc_type=SaleDocType.RETURN,
            original_sale_id=original.id,
            subtotal=-subtotal_net,
            discount_total=-discount_total,
            tax_total=-tax_total,
            grand_total=-grand_total,
            # Money handed back is negative for the same reason the totals are:
            # the shift's expected cash must fall by exactly this amount.
            paid_total=-refunded,
            change_due=_ZERO,
            balance_due=-_round(grand_total - refunded),
            notes=payload.notes,
            completed_at=datetime.now(timezone.utc),
            created_by_user_id=user_id,
            salesperson_user_id=original.salesperson_user_id,
        )
        credit.lines = lines
        credit.payments = [
            SalePayment(method=r.method, amount=-r.amount, reference=r.reference)
            for r in payload.refunds
        ]
        self.db.add(credit)
        await self.db.flush()

        # ---- stock comes back ------------------------------------------------
        inventory = InventoryService(self.db)
        for line_id, qty in requested.items():
            src = by_id[line_id]
            await inventory.post_movement(
                variant_id=src.variant_id,
                store_id=original.store_id,
                delta=qty,  # positive — the goods are physically back
                kind=MovementKind.SALE_RETURN,
                reference_type="sale_return",
                reference_id=credit.id,
                reason=f"Return against {original.number}: {payload.reason}",
                created_by_user_id=user_id,
                allow_negative=True,
            )

        # Logged against the ORIGINAL invoice: the question a person asks later
        # is "what happened to bill INV-…-0041", not "what is credit note 7".
        await AuditService(self.db).log(
            action="sale.returned",
            summary=(
                f"Credit note {number} against {original.number} "
                f"(₹{grand_total}): {payload.reason}"
            ),
            entity_type="sale",
            entity_id=original.id,
            changes={
                "credit_note": number,
                "credit_note_id": str(credit.id),
                "reason": payload.reason,
                "credit_value": str(grand_total),
                "refunded": str(refunded),
            },
        )

        # ---- points come back too --------------------------------------------
        #
        # Proportional to the share of the bill being returned, so a customer
        # returning one item of four keeps three quarters of what they earned.
        # Reversing the whole lot on a partial return would punish them for a
        # single exchange; reversing nothing would let a full return keep the
        # points on goods the shop has back on its shelf.
        if original.customer_id is not None and original.grand_total > _ZERO:
            await LoyaltyService(self.db).reverse_for_sale(
                sale_id=original.id,
                reason=f"Return against {original.number}: {payload.reason}",
                user_id=user_id,
                fraction=grand_total / original.grand_total,
            )

        if restating:
            await self._restate_closed_session(
                session=session, sale_id=credit.id, user_id=user_id
            )

        return await self.get(credit.id)

    async def create_advance(
        self, payload: AdvanceCreate, *, user_id: uuid.UUID | None
    ) -> Sale:
        """Money taken before goods are given.

        Stored as a `sales` row with NO lines and grand_total 0, because an
        advance is not revenue — nothing has been delivered. The money lands as
        a NEGATIVE balance_due, meaning the shop owes the customer goods.

        That sign is what makes every existing aggregate correct untouched:
          - revenue sums grand_total, which is 0, so an advance is not sales
          - the shift's expected cash sums payments, which are positive, so the
            money in the drawer is accounted for
          - the credit-limit check sums balance_due, so an advance REDUCES what
            the customer may owe, which is exactly right
        """
        if payload.client_uuid:
            existing = await self.db.scalar(
                select(Sale).where(Sale.client_uuid == payload.client_uuid)
            )
            if existing is not None:
                return await self.get(existing.id)

        store = await self.db.get(Store, payload.store_id)
        if store is None:
            raise NotFoundError("Store not found.", code="STORE_NOT_FOUND")

        customer = await self.db.get(Customer, payload.customer_id)
        if customer is None:
            raise NotFoundError("Customer not found.", code="CUSTOMER_NOT_FOUND")

        session, restating = await self._resolve_session_for(
            store_id=payload.store_id, day_session_id=payload.day_session_id
        )
        occurred_at = payload.occurred_at or datetime.now(timezone.utc)
        amount = _round(sum((p.amount for p in payload.payments), start=_ZERO))

        number = await self._assign_number(
            store, occurred_at, doc_type=SaleDocType.ADVANCE
        )

        advance = Sale(
            number=number,
            client_uuid=payload.client_uuid,
            occurred_at=occurred_at,
            terminal_uuid=payload.terminal_uuid,
            store_id=payload.store_id,
            day_session_id=session.id,
            customer_id=payload.customer_id,
            status=SaleStatus.COMPLETED,
            doc_type=SaleDocType.ADVANCE,
            subtotal=_ZERO,
            discount_total=_ZERO,
            tax_total=_ZERO,
            # No goods, so no revenue and no tax. GST on an advance is a
            # separate question the shop's accountant answers at filing time,
            # not something to invent here.
            grand_total=_ZERO,
            paid_total=amount,
            change_due=_ZERO,
            balance_due=-amount,
            notes=payload.notes,
            completed_at=datetime.now(timezone.utc),
            created_by_user_id=user_id,
        )
        advance.payments = [
            SalePayment(method=p.method, amount=p.amount, reference=p.reference)
            for p in payload.payments
        ]
        self.db.add(advance)
        await self.db.flush()

        await AuditService(self.db).log(
            action="sale.advance_received",
            summary=f"Advance {number} from {customer.name}: ₹{amount}",
            entity_type="sale",
            entity_id=advance.id,
            changes={"amount": str(amount), "customer_id": str(payload.customer_id)},
        )

        if restating:
            await self._restate_closed_session(
                session=session, sale_id=advance.id, user_id=user_id
            )
        return await self.get(advance.id)

    async def customer_balance(self, customer_id: uuid.UUID) -> CustomerBalance:
        """What this customer owes, and what the shop holds for them.

        One query over balance_due, split by sign. Bills owed are positive;
        advances and un-refunded credit notes are negative.
        """
        rows = await self.db.execute(
            select(Sale.balance_due).where(
                Sale.customer_id == customer_id,
                Sale.status == SaleStatus.COMPLETED,
            )
        )
        owed = _ZERO
        held = _ZERO
        for (bal,) in rows.all():
            value = Decimal(str(bal or 0))
            if value > _ZERO:
                owed += value
            else:
                held += -value
        return CustomerBalance(
            customer_id=customer_id,
            net_balance=_round(owed - held),
            owed_by_customer=_round(owed),
            advance_held=_round(held),
        )

    async def _returned_quantities(
        self, sale_id: uuid.UUID
    ) -> dict[uuid.UUID, Decimal]:
        """Units already credited per original line, as POSITIVE numbers.

        Credit-note lines carry negative quantity and do not reference the
        original line directly, so they are matched on variant within the credit
        notes that point at this invoice. Voided credit notes are excluded —
        voiding one puts the goods back on sale, which makes them returnable
        again.
        """
        rows = await self.db.execute(
            select(SaleLine.variant_id, func.sum(SaleLine.quantity))
            .join(Sale, Sale.id == SaleLine.sale_id)
            .where(
                Sale.original_sale_id == sale_id,
                Sale.doc_type == SaleDocType.RETURN,
                Sale.status == SaleStatus.COMPLETED,
            )
            .group_by(SaleLine.variant_id)
        )
        by_variant = {vid: -Decimal(str(total)) for vid, total in rows.all()}
        if not by_variant:
            return {}

        original = await self.get(sale_id)
        out: dict[uuid.UUID, Decimal] = {}
        for line in sorted(original.lines, key=lambda l: l.sort_order):
            avail = by_variant.get(line.variant_id, _ZERO)
            if avail <= _ZERO:
                continue
            take = min(avail, line.quantity)
            out[line.id] = take
            by_variant[line.variant_id] = avail - take
        return out

    async def _resolve_session_for(
        self, *, store_id: uuid.UUID, day_session_id: uuid.UUID | None
    ) -> tuple[DaySession, bool]:
        """The shift a document belongs to, and whether it is already closed."""
        if day_session_id is not None:
            session = await self.db.get(DaySession, day_session_id)
            if session is None:
                raise NotFoundError(
                    "Day session not found.", code="DAY_SESSION_NOT_FOUND"
                )
            if session.store_id != store_id:
                raise ValidationError(
                    "That day session belongs to a different store.",
                    code="DAY_SESSION_STORE_MISMATCH",
                )
            return session, session.status is not DayStatus.OPEN

        session = await DaySessionService(self.db).get_open_for_store(store_id)
        if session is None:
            raise ValidationError(
                "No open day session for this store. Open one before recording a return.",
                code="NO_OPEN_DAY_SESSION",
            )
        return session, False

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    async def _assign_number(
        self,
        store: Store,
        effective_at: datetime,
        *,
        doc_type: SaleDocType = SaleDocType.SALE,
    ) -> str:
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
                SaleNumberSequence.doc_type == doc_type.value,
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
                            store_id=store.id,
                            year_month=year_month,
                            doc_type=doc_type.value,
                            next_seq=1,
                        )
                    )
            except IntegrityError:
                pass
            row = await self.db.scalar(
                select(SaleNumberSequence)
                .where(
                    SaleNumberSequence.store_id == store.id,
                    SaleNumberSequence.year_month == year_month,
                    SaleNumberSequence.doc_type == doc_type.value,
                )
                .with_for_update()
            )

        seq = row.next_seq
        row.next_seq = seq + 1
        await self.db.flush()
        # Each document type carries its own serial series. GST requires it for
        # credit notes, and an advance sharing the INV counter would collide on
        # uq_sales_number the moment a real invoice reached the same ordinal —
        # which is exactly how this was caught.
        prefix = {
            SaleDocType.RETURN: "CRN",
            SaleDocType.ADVANCE: "ADV",
        }.get(doc_type, "INV")
        return f"{prefix}-{store.code}-{year_month}-{seq:04d}"
