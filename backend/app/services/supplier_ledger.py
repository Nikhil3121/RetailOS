"""What the shop owes its suppliers, and what a purchase really cost.

RetailOS tracked customer dues in detail and knew nothing about payables. A
shop that buys on credit from mills needs the other side of that: what is
outstanding to whom, and how old it is.

THE BALANCE IS DERIVED, NEVER STORED
------------------------------------
Outstanding is `SUM(credit) - SUM(debit)` over the entries. Caching it on
`suppliers` would be faster and would drift the first time a document was
edited or a receipt reversed — and a payables figure nobody trusts is worse
than no figure, because it gets paid twice or not at all.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, ValidationError
from app.db.models.supplier import Supplier
from app.db.models.supplier_ledger import (
    PurchaseOrderCharge,
    SupplierEntryType,
    SupplierLedgerEntry,
)

_ZERO = Decimal("0.00")


@dataclass
class SupplierBalance:
    supplier_id: uuid.UUID
    supplier_name: str
    #: Positive means the shop owes the supplier.
    outstanding: Decimal
    total_purchased: Decimal
    total_paid: Decimal
    last_entry_on: date | None


class SupplierLedgerService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Writing
    # ------------------------------------------------------------------

    async def _post(
        self,
        *,
        supplier_id: uuid.UUID,
        entry_type: SupplierEntryType,
        entry_date: date,
        debit: Decimal = _ZERO,
        credit: Decimal = _ZERO,
        reference: str | None = None,
        description: str | None = None,
        purchase_order_id: uuid.UUID | None = None,
        store_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
    ) -> SupplierLedgerEntry:
        """The only writer. Every balance change goes through here."""
        if debit < _ZERO or credit < _ZERO:
            raise ValidationError(
                "Ledger amounts are always positive — the SIDE carries the direction.",
                code="LEDGER_NEGATIVE_AMOUNT",
            )
        if debit == _ZERO and credit == _ZERO:
            raise ValidationError("A ledger entry cannot be for nothing.",
                                  code="LEDGER_ZERO_AMOUNT")
        if debit > _ZERO and credit > _ZERO:
            raise ValidationError(
                "An entry is a debit or a credit, never both.",
                code="LEDGER_BOTH_SIDES",
            )

        entry = SupplierLedgerEntry(
            supplier_id=supplier_id,
            store_id=store_id,
            entry_date=entry_date,
            entry_type=entry_type.value,
            reference=reference,
            description=description,
            debit=debit.quantize(Decimal("0.01")),
            credit=credit.quantize(Decimal("0.01")),
            purchase_order_id=purchase_order_id,
            created_by_user_id=user_id,
        )
        self.db.add(entry)
        await self.db.flush()
        return entry

    async def record_purchase(
        self,
        *,
        supplier_id: uuid.UUID,
        amount: Decimal,
        on_date: date,
        reference: str | None = None,
        purchase_order_id: uuid.UUID | None = None,
        store_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
    ) -> SupplierLedgerEntry:
        """Goods received — the shop now owes this money."""
        return await self._post(
            supplier_id=supplier_id,
            entry_type=SupplierEntryType.PURCHASE,
            entry_date=on_date,
            credit=amount,
            reference=reference,
            description=f"Goods received{f' — {reference}' if reference else ''}",
            purchase_order_id=purchase_order_id,
            store_id=store_id,
            user_id=user_id,
        )

    async def record_payment(
        self,
        *,
        supplier_id: uuid.UUID,
        amount: Decimal,
        on_date: date,
        reference: str | None = None,
        description: str | None = None,
        store_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
    ) -> SupplierLedgerEntry:
        """Money paid out — the debt falls."""
        if amount <= _ZERO:
            raise ValidationError("Pay a positive amount.", code="INVALID_PAYMENT")
        supplier = await self.db.get(Supplier, supplier_id)
        if supplier is None:
            raise NotFoundError("Supplier not found.", code="SUPPLIER_NOT_FOUND")

        return await self._post(
            supplier_id=supplier_id,
            entry_type=SupplierEntryType.PAYMENT,
            entry_date=on_date,
            debit=amount,
            reference=reference,
            description=description or "Payment",
            store_id=store_id,
            user_id=user_id,
        )

    async def record_opening_balance(
        self,
        *,
        supplier_id: uuid.UUID,
        amount: Decimal,
        on_date: date,
        user_id: uuid.UUID | None = None,
    ) -> SupplierLedgerEntry:
        """What was already owed when the shop moved onto RetailOS.

        Needed at go-live: without it every supplier starts at zero and the
        first payment drives the balance negative.
        """
        return await self._post(
            supplier_id=supplier_id,
            entry_type=SupplierEntryType.OPENING_BALANCE,
            entry_date=on_date,
            credit=amount,
            description="Opening balance",
            user_id=user_id,
        )

    async def adjust(
        self,
        *,
        supplier_id: uuid.UUID,
        amount: Decimal,
        on_date: date,
        description: str,
        user_id: uuid.UUID | None = None,
    ) -> SupplierLedgerEntry:
        """A manual correction. Positive increases the debt, negative reduces it.

        A description is REQUIRED: an unexplained movement on a payables
        account is exactly what an audit exists to find.
        """
        if not description.strip():
            raise ValidationError("Say why.", code="ADJUSTMENT_NEEDS_REASON")
        if amount == _ZERO:
            raise ValidationError("Adjust by a non-zero amount.",
                                  code="LEDGER_ZERO_AMOUNT")

        return await self._post(
            supplier_id=supplier_id,
            entry_type=SupplierEntryType.ADJUSTMENT,
            entry_date=on_date,
            credit=amount if amount > _ZERO else _ZERO,
            debit=-amount if amount < _ZERO else _ZERO,
            description=description,
            user_id=user_id,
        )

    # ------------------------------------------------------------------
    # Reading
    # ------------------------------------------------------------------

    async def entries(
        self, supplier_id: uuid.UUID, *, limit: int = 200
    ) -> list[SupplierLedgerEntry]:
        """Newest first — the order someone checking a balance reads them in."""
        rows = await self.db.execute(
            select(SupplierLedgerEntry)
            .where(SupplierLedgerEntry.supplier_id == supplier_id)
            .order_by(
                SupplierLedgerEntry.entry_date.desc(),
                SupplierLedgerEntry.created_at.desc(),
            )
            .limit(limit)
        )
        return list(rows.scalars().all())

    async def balance_for(self, supplier_id: uuid.UUID) -> Decimal:
        row = await self.db.execute(
            select(
                func.coalesce(func.sum(SupplierLedgerEntry.credit), 0)
                - func.coalesce(func.sum(SupplierLedgerEntry.debit), 0)
            ).where(SupplierLedgerEntry.supplier_id == supplier_id)
        )
        return Decimal(str(row.scalar() or 0)).quantize(Decimal("0.01"))

    async def outstanding(self, *, only_owing: bool = True) -> list[SupplierBalance]:
        """Every supplier's position, largest debt first."""
        stmt = (
            select(
                Supplier.id,
                Supplier.name,
                func.coalesce(func.sum(SupplierLedgerEntry.credit), 0),
                func.coalesce(func.sum(SupplierLedgerEntry.debit), 0),
                func.max(SupplierLedgerEntry.entry_date),
            )
            .join(SupplierLedgerEntry, SupplierLedgerEntry.supplier_id == Supplier.id)
            .group_by(Supplier.id, Supplier.name)
        )

        out: list[SupplierBalance] = []
        for sid, name, credit, debit, last in (await self.db.execute(stmt)).all():
            purchased = Decimal(str(credit or 0))
            paid = Decimal(str(debit or 0))
            balance = (purchased - paid).quantize(Decimal("0.01"))
            if only_owing and balance <= _ZERO:
                continue
            out.append(
                SupplierBalance(
                    supplier_id=sid,
                    supplier_name=name,
                    outstanding=balance,
                    total_purchased=purchased.quantize(Decimal("0.01")),
                    total_paid=paid.quantize(Decimal("0.01")),
                    last_entry_on=last,
                )
            )

        out.sort(key=lambda b: b.outstanding, reverse=True)
        return out

    # ------------------------------------------------------------------
    # Landed cost
    # ------------------------------------------------------------------

    async def charges_total(self, purchase_order_id: uuid.UUID) -> Decimal:
        """Net of charges less deductions, each including its own tax.

        This is what separates the invoice rate from the landed cost.
        """
        rows = await self.db.execute(
            select(PurchaseOrderCharge).where(
                PurchaseOrderCharge.purchase_order_id == purchase_order_id
            )
        )
        return sum(
            (c.signed_total for c in rows.scalars().all()), _ZERO
        ).quantize(Decimal("0.01"))
