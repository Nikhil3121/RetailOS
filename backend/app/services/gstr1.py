"""GSTR-1 — the monthly outward-supplies return, as a working paper.

WHAT THIS IS, AND WHAT IT IS NOT
It is the arithmetic of GSTR-1, laid out the way the return is laid out, so
whoever files it can tie the figures to the books without re-adding a month of
bills by hand. Every section the return has, this produces: B2B invoice-wise,
B2C summarised, credit notes, the HSN summary, and the document ranges.

It is NOT a portal upload. The GSTN JSON schema is versioned, changes without
much notice, and rejects on details that only appear when you actually submit.
Software that claims to emit portal-ready JSON without ever having been
validated against the portal is how a wrong return gets filed with confidence,
and this system has never touched the portal.

THE THREE THINGS THAT ARE EASY TO GET WRONG
-------------------------------------------
1. SIGNS. This system stores credit notes as negative money so that every
   revenue aggregate nets them out for free. GSTR-1 does the opposite: a
   credit note reduces the liability by BEING a credit note, and is reported
   positive. Flipping it here rather than at the filing desk is what stops a
   return being deducted twice.

2. PLACE OF SUPPLY. For a registered customer it is the state encoded in
   their GSTIN — read from the number itself, so it cannot disagree with the
   number the way a separately-typed state field can. For a counter sale it is
   the shop's own state: goods handed over the counter are supplied where the
   counter is, whatever address the customer gave.

3. WHAT IS MISSING. A line with no HSN code, a customer with a malformed
   GSTIN — these do not silently vanish into a smaller total. They are
   counted, described, and returned as warnings, because an accountant who is
   not told will file short.
"""

from __future__ import annotations

import re
import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError, ValidationError
from app.db.models.sale import Sale, SaleDocType, SaleStatus
from app.db.models.store import Store
from app.schemas.gstr1 import (
    Gstr1B2bInvoice,
    Gstr1B2csRow,
    Gstr1CreditNote,
    Gstr1DocumentRange,
    Gstr1HsnRow,
    Gstr1RateLine,
    Gstr1Return,
)

_ZERO = Decimal("0.00")
_GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$")


def _round(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"))


def _state_code(gstin: str | None) -> str | None:
    """The two digits a GSTIN starts with.

    Read from the number rather than from a state field, because the number
    IS the authority: a customer whose GSTIN says 09 and whose address says
    Maharashtra has one of the two entered wrong, and the return has to follow
    the one the tax office will check.
    """
    if not gstin or len(gstin) < 2 or not gstin[:2].isdigit():
        return None
    return gstin[:2]


class Gstr1Service:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def build(
        self,
        *,
        store_id: uuid.UUID,
        from_date: date,
        to_date: date,
    ) -> Gstr1Return:
        store = await self.db.get(Store, store_id)
        if store is None:
            raise NotFoundError("Store not found.", code="STORE_NOT_FOUND")
        if not store.gstin:
            # A return is filed against a GSTIN. Producing one for a store
            # that has none would be a document nobody can file, handed over
            # as though it were finished.
            raise ValidationError(
                "This branch has no GSTIN, so no return can be prepared for it.",
                code="STORE_HAS_NO_GSTIN",
                details={"store": store.name},
            )

        home_state = _state_code(store.gstin)
        warnings: list[str] = []

        # `func.date(...)` rather than comparing the timestamp column against a
        # bare date: the column is timezone-aware, a `date` is not, and the
        # driver refuses the comparison outright. Same predicate the other
        # reports use, so a GSTR-1 total and a sales summary for the same month
        # cover exactly the same bills.
        sales = list(
            (
                await self.db.scalars(
                    select(Sale)
                    .where(
                        Sale.store_id == store_id,
                        Sale.status == SaleStatus.COMPLETED,
                        func.date(Sale.created_at).between(from_date, to_date),
                    )
                    .options(selectinload(Sale.lines), selectinload(Sale.customer))
                    .order_by(Sale.created_at)
                )
            ).all()
        )

        b2b: list[Gstr1B2bInvoice] = []
        credit_notes: list[Gstr1CreditNote] = []
        # (place_of_supply, rate) -> [taxable, cgst, sgst, igst, count]
        b2cs: dict[tuple[str, Decimal], list[Decimal]] = defaultdict(
            lambda: [_ZERO, _ZERO, _ZERO, _ZERO, Decimal(0)]
        )
        hsn: dict[str, list] = {}

        total_taxable = _ZERO
        total_tax = _ZERO
        total_value = _ZERO

        missing_hsn = 0
        bad_gstin: list[str] = []

        for sale in sales:
            customer = sale.customer
            gstin = (customer.gstin or "").strip().upper() if customer else ""
            registered = bool(gstin)
            if registered and not _GSTIN_RE.match(gstin):
                # Kept in the return — the sale happened — but named, because
                # the portal will reject the row and the person filing needs to
                # know which customer to fix.
                bad_gstin.append(f"{customer.name} ({gstin})")

            recipient_state = _state_code(gstin) if registered else home_state
            # An over-the-counter sale is supplied where the counter is. The
            # customer's address does not move the place of supply for goods
            # handed across a desk.
            place = recipient_state or home_state or "00"
            inter_state = place != home_state

            # ---- rate-wise split of this document --------------------------
            by_rate: dict[Decimal, list[Decimal]] = defaultdict(
                lambda: [_ZERO, _ZERO, _ZERO, _ZERO]
            )
            for line in sale.lines:
                taxable = abs(line.subtotal)
                tax = abs(line.tax_amount)
                rate = line.tax_rate
                bucket = by_rate[rate]
                bucket[0] += taxable
                if inter_state:
                    bucket[3] += tax
                else:
                    half = _round(tax / 2)
                    bucket[1] += half
                    # The remainder, not a second halving — an odd number of
                    # paise must not disappear between CGST and SGST.
                    bucket[2] += tax - half

                # ---- HSN summary -------------------------------------------
                code = (line.hsn_code or "").strip()
                if not code:
                    missing_hsn += 1
                else:
                    entry = hsn.setdefault(
                        code,
                        [line.product_name, "PCS", _ZERO, _ZERO, _ZERO, _ZERO, _ZERO],
                    )
                    entry[2] += abs(line.quantity)
                    entry[3] += taxable
                    if inter_state:
                        entry[6] += tax
                    else:
                        half = _round(tax / 2)
                        entry[4] += half
                        entry[5] += tax - half

            rate_lines = [
                Gstr1RateLine(
                    rate=rate,
                    taxable_value=_round(v[0]),
                    cgst=_round(v[1]),
                    sgst=_round(v[2]),
                    igst=_round(v[3]),
                )
                for rate, v in sorted(by_rate.items())
            ]

            doc_value = abs(sale.grand_total)
            total_value += doc_value
            for rl in rate_lines:
                total_taxable += rl.taxable_value
                total_tax += rl.cgst + rl.sgst + rl.igst

            # ---- which section it belongs to -------------------------------
            if sale.doc_type is SaleDocType.RETURN:
                original = None
                if sale.original_sale_id is not None:
                    original = await self.db.get(Sale, sale.original_sale_id)
                credit_notes.append(
                    Gstr1CreditNote(
                        note_number=sale.number,
                        note_date=sale.created_at.date(),
                        original_invoice_number=original.number if original else None,
                        customer_gstin=gstin or None,
                        customer_name=customer.name if customer else None,
                        place_of_supply=place,
                        # POSITIVE. Storage keeps returns negative so revenue
                        # aggregates net out; the return reports them the other
                        # way, and doing the flip anywhere but here means it
                        # eventually gets done twice or not at all.
                        note_value=doc_value,
                        lines=rate_lines,
                    )
                )
            elif registered:
                b2b.append(
                    Gstr1B2bInvoice(
                        invoice_number=sale.number,
                        invoice_date=sale.created_at.date(),
                        customer_gstin=gstin,
                        customer_name=customer.name if customer else "",
                        invoice_value=doc_value,
                        place_of_supply=place,
                        lines=rate_lines,
                    )
                )
            else:
                for rl in rate_lines:
                    bucket = b2cs[(place, rl.rate)]
                    bucket[0] += rl.taxable_value
                    bucket[1] += rl.cgst
                    bucket[2] += rl.sgst
                    bucket[3] += rl.igst
                # Counted once per BILL, not once per rate — the figure an
                # accountant reconciles against is the number of bills.
                b2cs[(place, rate_lines[0].rate)][4] += 1 if rate_lines else 0

        # ---- document ranges ------------------------------------------------
        #
        # From the numbers actually allocated. A gap in an invoice series is
        # the first thing an officer looks for, so this reports the real first
        # and last rather than a count of rows.
        documents: list[Gstr1DocumentRange] = []
        for label, docs in (
            ("Invoices for outward supply", [s for s in sales if s.doc_type is SaleDocType.SALE]),
            ("Credit notes", [s for s in sales if s.doc_type is SaleDocType.RETURN]),
        ):
            if not docs:
                continue
            numbers = sorted(d.number for d in docs)
            documents.append(
                Gstr1DocumentRange(
                    document_type=label,
                    from_number=numbers[0],
                    to_number=numbers[-1],
                    total_count=len(numbers),
                    # Voided bills are excluded from `sales` above, so they are
                    # not counted here either. Reporting them as cancelled
                    # would be a separate query and a claim this cannot yet
                    # make honestly.
                    cancelled_count=0,
                )
            )

        if missing_hsn:
            warnings.append(
                f"{missing_hsn} sale line(s) have no HSN code and are missing from "
                f"the HSN summary. The HSN section is mandatory — set the code on "
                f"those products before filing."
            )
        if bad_gstin:
            shown = ", ".join(sorted(set(bad_gstin))[:5])
            warnings.append(
                f"{len(set(bad_gstin))} customer(s) have a GSTIN that is not in the "
                f"correct format and will be rejected by the portal: {shown}"
            )

        return Gstr1Return(
            gstin=store.gstin,
            store_name=store.name,
            from_date=from_date,
            to_date=to_date,
            b2b=b2b,
            b2cs=[
                Gstr1B2csRow(
                    place_of_supply=place,
                    rate=rate,
                    taxable_value=_round(v[0]),
                    cgst=_round(v[1]),
                    sgst=_round(v[2]),
                    igst=_round(v[3]),
                    invoice_count=int(v[4]),
                )
                for (place, rate), v in sorted(b2cs.items())
            ],
            credit_notes=credit_notes,
            hsn=[
                Gstr1HsnRow(
                    hsn_code=code,
                    description=v[0],
                    uqc=v[1],
                    quantity=v[2],
                    taxable_value=_round(v[3]),
                    cgst=_round(v[4]),
                    sgst=_round(v[5]),
                    igst=_round(v[6]),
                )
                for code, v in sorted(hsn.items())
            ],
            documents=documents,
            total_taxable_value=_round(total_taxable),
            total_tax=_round(total_tax),
            total_invoice_value=_round(total_value),
            warnings=warnings,
        )
