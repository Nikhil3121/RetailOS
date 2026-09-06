"""Purchase-order lifecycle.

State machine:
    DRAFT ── confirm ─▶ CONFIRMED ── receive ─▶ RECEIVED
      │                                │
      └────────── cancel ──────────────┘

- DRAFT is fully editable (add/remove/replace lines).
- CONFIRMED freezes totals and lines. Only cancel or receive are legal from here.
- RECEIVED posts stock movements and locks the PO permanently.
- CANCELLED is terminal — no further transitions.

Totals are recomputed on every write while DRAFT. On CONFIRM they're snapshotted
and never mutate again, so downstream reports can trust them without joining lines.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.db.models.inventory import MovementKind
from app.db.models.product import Product, ProductVariant
from app.db.models.purchase import PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus
from app.db.models.store import Store
from app.db.models.supplier import Supplier
from app.schemas.purchase import (
    POLineCreate,
    PurchaseOrderCreate,
    PurchaseOrderSummary,
    PurchaseOrderUpdate,
)
from app.services.inventory import InventoryService
from app.services.supplier_ledger import SupplierLedgerService


_ZERO = Decimal("0.00")


def _round(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class PurchaseService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Create / update / read
    # ------------------------------------------------------------------
    async def create(
        self, payload: PurchaseOrderCreate, *, user_id: uuid.UUID | None
    ) -> PurchaseOrder:
        await self._resolve_or_raise(
            Supplier, payload.supplier_id, "SUPPLIER_NOT_FOUND", "Supplier not found."
        )
        await self._resolve_or_raise(
            Store, payload.store_id, "STORE_NOT_FOUND", "Store not found."
        )
        await self._validate_variants(payload.lines)

        po = PurchaseOrder(
            number=self._generate_number(),
            supplier_id=payload.supplier_id,
            store_id=payload.store_id,
            status=PurchaseOrderStatus.DRAFT,
            order_date=payload.order_date,
            expected_date=payload.expected_date,
            notes=payload.notes,
            created_by_user_id=user_id,
        )
        po.lines = self._build_lines(payload.lines)
        self._apply_totals(po)

        self.db.add(po)
        await self.db.flush()
        return await self.get(po.id)

    async def get(self, po_id: uuid.UUID) -> PurchaseOrder:
        stmt = (
            select(PurchaseOrder)
            .where(PurchaseOrder.id == po_id)
            .options(selectinload(PurchaseOrder.lines))
        )
        po = await self.db.scalar(stmt)
        if po is None:
            raise NotFoundError("Purchase order not found.", code="PO_NOT_FOUND")
        return po

    async def list(
        self,
        *,
        page: int = 1,
        page_size: int = 50,
        status: PurchaseOrderStatus | None = None,
        supplier_id: uuid.UUID | None = None,
        store_id: uuid.UUID | None = None,
    ) -> tuple[list[PurchaseOrderSummary], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 1000)

        base = select(PurchaseOrder)
        if status is not None:
            base = base.where(PurchaseOrder.status == status)
        if supplier_id is not None:
            base = base.where(PurchaseOrder.supplier_id == supplier_id)
        if store_id is not None:
            base = base.where(PurchaseOrder.store_id == store_id)

        total = await self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = (
            await self.db.scalars(
                base.options(selectinload(PurchaseOrder.lines))
                .order_by(PurchaseOrder.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()

        summaries = [
            PurchaseOrderSummary(
                id=p.id,
                number=p.number,
                supplier_id=p.supplier_id,
                store_id=p.store_id,
                status=p.status,
                order_date=p.order_date,
                expected_date=p.expected_date,
                grand_total=p.grand_total,
                line_count=len(p.lines),
                created_at=p.created_at,
            )
            for p in rows
        ]
        return summaries, int(total)

    async def update(self, po_id: uuid.UUID, payload: PurchaseOrderUpdate) -> PurchaseOrder:
        po = await self.get(po_id)
        self._assert_status(po, {PurchaseOrderStatus.DRAFT}, "edit")

        data = payload.model_dump(exclude_unset=True)

        if "supplier_id" in data and data["supplier_id"] is not None:
            await self._resolve_or_raise(
                Supplier, data["supplier_id"], "SUPPLIER_NOT_FOUND", "Supplier not found."
            )
            po.supplier_id = data["supplier_id"]

        if "expected_date" in data:
            po.expected_date = data["expected_date"]
        if "notes" in data:
            po.notes = data["notes"]

        if payload.lines is not None:
            await self._validate_variants(payload.lines)
            # Replace-in-place: SQLAlchemy handles the delete-orphan cascade.
            po.lines.clear()
            po.lines.extend(self._build_lines(payload.lines))
            self._apply_totals(po)

        await self.db.flush()
        return await self.get(po.id)

    # ------------------------------------------------------------------
    # Transitions
    # ------------------------------------------------------------------
    async def confirm(self, po_id: uuid.UUID) -> PurchaseOrder:
        po = await self.get(po_id)
        self._assert_status(po, {PurchaseOrderStatus.DRAFT}, "confirm")
        if not po.lines:
            raise ValidationError("Cannot confirm a PO with no lines.", code="EMPTY_PO")
        po.status = PurchaseOrderStatus.CONFIRMED
        await self.db.flush()
        return po

    async def cancel(self, po_id: uuid.UUID) -> PurchaseOrder:
        po = await self.get(po_id)
        if po.status in (PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.CANCELLED):
            raise ConflictError(
                f"Cannot cancel a PO in status {po.status.value}.",
                code="PO_INVALID_TRANSITION",
            )
        po.status = PurchaseOrderStatus.CANCELLED
        await self.db.flush()
        return po

    async def receive(
        self, po_id: uuid.UUID, *, user_id: uuid.UUID | None
    ) -> PurchaseOrder:
        """Post stock movements for every line, then lock the PO in RECEIVED."""
        po = await self.get(po_id)
        self._assert_status(po, {PurchaseOrderStatus.CONFIRMED}, "receive")

        inventory = InventoryService(self.db)

        # Purchase quantities are entered in the PURCHASE unit — cartons — and
        # stock is only ever held in the BASE unit. Convert once, here, at the
        # single point where goods enter the ledger. Doing it in the UI instead
        # would put the shop's stock accuracy in the hands of mental arithmetic
        # at the receiving bay.
        factors = await self._conversion_factors([l.variant_id for l in po.lines])

        for line in po.lines:
            await inventory.post_movement(
                variant_id=line.variant_id,
                store_id=po.store_id,
                delta=line.quantity * factors.get(line.variant_id, Decimal("1")),
                kind=MovementKind.PURCHASE_RECEIPT,
                unit_cost=line.unit_cost,
                reference_type="purchase_order",
                reference_id=po.id,
                reason=f"PO {po.number}",
                created_by_user_id=user_id,
            )

        po.status = PurchaseOrderStatus.RECEIVED
        po.received_at = datetime.now(timezone.utc)
        await self.db.flush()

        # ---- what we now owe the supplier ---------------------------------
        #
        # Posted at RECEIPT, not at confirmation: a purchase order is an
        # intention, and the debt only exists once the goods are in the
        # building. Any freight or deduction agreed on the bill moves the
        # figure, which is why the charges are added in rather than the plain
        # grand total being used.
        ledger = SupplierLedgerService(self.db)
        charges = await ledger.charges_total(po.id)
        owed = (po.grand_total + charges).quantize(Decimal("0.01"))
        if owed > Decimal("0.00"):
            await ledger.record_purchase(
                supplier_id=po.supplier_id,
                amount=owed,
                on_date=po.order_date,
                reference=po.number,
                purchase_order_id=po.id,
                store_id=po.store_id,
                user_id=user_id,
            )

        return po

    async def _conversion_factors(
        self, variant_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, Decimal]:
        """Base units per purchase unit, per variant.

        Defaults to 1 for anything without a purchase unit configured, which is
        every product until someone sets one — so existing behaviour is
        unchanged rather than merely similar.
        """
        if not variant_ids:
            return {}
        rows = await self.db.execute(
            select(ProductVariant.id, Product.purchase_unit_id, Product.purchase_conversion)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(ProductVariant.id.in_(variant_ids))
        )
        out: dict[uuid.UUID, Decimal] = {}
        for vid, purchase_unit_id, factor in rows.all():
            # No purchase unit means the PO was written in base units already.
            out[vid] = Decimal(str(factor)) if purchase_unit_id else Decimal("1")
        return out

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _build_lines(self, payload_lines: Iterable[POLineCreate]) -> list[PurchaseOrderLine]:
        out: list[PurchaseOrderLine] = []
        for idx, line in enumerate(payload_lines):
            subtotal = _round(line.quantity * line.unit_cost)
            tax_amount = _round(subtotal * (line.tax_rate / Decimal("100")))
            out.append(
                PurchaseOrderLine(
                    variant_id=line.variant_id,
                    quantity=line.quantity,
                    unit_cost=line.unit_cost,
                    tax_rate=line.tax_rate,
                    subtotal=subtotal,
                    tax_amount=tax_amount,
                    line_total=_round(subtotal + tax_amount),
                    sort_order=idx,
                )
            )
        return out

    def _apply_totals(self, po: PurchaseOrder) -> None:
        subtotal = sum((line.subtotal for line in po.lines), start=_ZERO)
        tax_total = sum((line.tax_amount for line in po.lines), start=_ZERO)
        po.subtotal = _round(subtotal)
        po.tax_total = _round(tax_total)
        po.grand_total = _round(subtotal + tax_total)

    def _assert_status(
        self, po: PurchaseOrder, allowed: set[PurchaseOrderStatus], action: str
    ) -> None:
        if po.status not in allowed:
            raise ConflictError(
                f"Cannot {action} a PO in status {po.status.value}.",
                code="PO_INVALID_TRANSITION",
                details={
                    "current": po.status.value,
                    "allowed": sorted(s.value for s in allowed),
                },
            )

    async def _validate_variants(self, lines: Iterable[POLineCreate]) -> None:
        ids = {line.variant_id for line in lines}
        if not ids:
            raise ValidationError("At least one line is required.", code="EMPTY_PO")
        found = (
            await self.db.scalars(select(ProductVariant.id).where(ProductVariant.id.in_(ids)))
        ).all()
        missing = ids - set(found)
        if missing:
            raise NotFoundError(
                f"Variants not found: {sorted(str(m) for m in missing)}",
                code="VARIANT_NOT_FOUND",
            )

    async def _resolve_or_raise(self, model, id_: uuid.UUID, code: str, msg: str) -> None:
        row = await self.db.get(model, id_)
        if row is None:
            raise NotFoundError(msg, code=code)

    def _generate_number(self) -> str:
        # PO-YYYYMMDD-XXXXXX  (6 hex chars ≈ 16.7M/day collision space)
        today = date.today().strftime("%Y%m%d")
        return f"PO-{today}-{secrets.token_hex(3).upper()}"
