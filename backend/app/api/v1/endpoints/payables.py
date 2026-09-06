"""Payables — what the shop owes its suppliers, and what purchases really cost.

The mirror of `/billing/outstanding`, which answers the same question about
customers. RetailOS has always had one side and not the other.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, require_min_role
from app.db.models.supplier_ledger import PriceChange, PurchaseOrderCharge
from app.db.models.user import UserRole
from app.schemas.common import ORMModel
from app.services.audit import AuditService
from app.services.supplier_ledger import SupplierLedgerService

router = APIRouter(prefix="/payables", tags=["payables"])


# ---------------------------------------------------------------------------
# DTOs
# ---------------------------------------------------------------------------


class SupplierBalanceRead(BaseModel):
    supplier_id: uuid.UUID
    supplier_name: str
    #: Positive = the shop owes the supplier.
    outstanding: Decimal
    total_purchased: Decimal
    total_paid: Decimal
    last_entry_on: date | None


class LedgerEntryRead(ORMModel):
    id: uuid.UUID
    supplier_id: uuid.UUID
    entry_date: date
    entry_type: str
    reference: str | None
    description: str | None
    debit: Decimal
    credit: Decimal
    purchase_order_id: uuid.UUID | None


class PaymentCreate(BaseModel):
    amount: Decimal = Field(gt=0, decimal_places=2, max_digits=14)
    entry_date: date
    reference: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=255)
    store_id: uuid.UUID | None = None


class OpeningBalanceCreate(BaseModel):
    amount: Decimal = Field(gt=0, decimal_places=2, max_digits=14)
    entry_date: date


class AdjustmentCreate(BaseModel):
    """Positive increases the debt, negative reduces it. Reason required."""

    amount: Decimal = Field(decimal_places=2, max_digits=14)
    entry_date: date
    description: str = Field(min_length=1, max_length=255)


class ChargeCreate(BaseModel):
    label: str = Field(min_length=1, max_length=128, description="e.g. 'Freight'")
    amount: Decimal = Field(gt=0, decimal_places=2, max_digits=14)
    tax_rate: Decimal = Field(default=Decimal("0.00"), ge=0, le=100,
                              decimal_places=2, max_digits=5)
    is_deduction: bool = Field(
        default=False,
        description="A shortage or damage allowance knocked off the bill.",
    )


class ChargeRead(ORMModel):
    id: uuid.UUID
    purchase_order_id: uuid.UUID
    label: str
    amount: Decimal
    tax_rate: Decimal
    is_deduction: bool


class PriceChangeRead(ORMModel):
    id: uuid.UUID
    variant_id: uuid.UUID
    old_cost_price: Decimal | None
    new_cost_price: Decimal | None
    old_mrp: Decimal | None
    new_mrp: Decimal | None
    old_selling_price: Decimal | None
    new_selling_price: Decimal | None
    reason: str | None


# ---------------------------------------------------------------------------
# Supplier balances
# ---------------------------------------------------------------------------


@router.get(
    "/outstanding",
    response_model=list[SupplierBalanceRead],
    summary="What the shop owes each supplier, largest first.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def outstanding(
    db: DbSession,
    include_settled: bool = Query(False, description="Also show suppliers at zero."),
) -> list[SupplierBalanceRead]:
    rows = await SupplierLedgerService(db).outstanding(only_owing=not include_settled)
    return [SupplierBalanceRead(**vars(r)) for r in rows]


@router.get(
    "/suppliers/{supplier_id}/ledger",
    response_model=list[LedgerEntryRead],
    summary="Every movement on one supplier's account, newest first.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def ledger(
    supplier_id: uuid.UUID,
    db: DbSession,
    limit: int = Query(200, ge=1, le=1000),
) -> list[LedgerEntryRead]:
    rows = await SupplierLedgerService(db).entries(supplier_id, limit=limit)
    return [LedgerEntryRead.model_validate(r) for r in rows]


@router.post(
    "/suppliers/{supplier_id}/payments",
    response_model=LedgerEntryRead,
    status_code=status.HTTP_201_CREATED,
    summary="Record money paid to a supplier.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def pay(
    supplier_id: uuid.UUID,
    payload: PaymentCreate,
    db: DbSession,
    user: CurrentUser,
) -> LedgerEntryRead:
    service = SupplierLedgerService(db)
    entry = await service.record_payment(
        supplier_id=supplier_id,
        amount=payload.amount,
        on_date=payload.entry_date,
        reference=payload.reference,
        description=payload.description,
        store_id=payload.store_id,
        user_id=user.id,
    )
    await AuditService(db).log(
        action="payable.payment",
        summary=f"Paid ₹{payload.amount} to supplier",
        entity_type="supplier",
        entity_id=supplier_id,
        actor=user,
        changes={"amount": str(payload.amount), "reference": payload.reference},
    )
    return LedgerEntryRead.model_validate(entry)


@router.post(
    "/suppliers/{supplier_id}/opening-balance",
    response_model=LedgerEntryRead,
    status_code=status.HTTP_201_CREATED,
    summary="What was already owed when the shop moved onto RetailOS.",
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def opening_balance(
    supplier_id: uuid.UUID,
    payload: OpeningBalanceCreate,
    db: DbSession,
    user: CurrentUser,
) -> LedgerEntryRead:
    """Needed at go-live.

    Without it every supplier starts at zero and the first payment made against
    an old bill drives the balance negative.
    """
    entry = await SupplierLedgerService(db).record_opening_balance(
        supplier_id=supplier_id,
        amount=payload.amount,
        on_date=payload.entry_date,
        user_id=user.id,
    )
    await AuditService(db).log(
        action="payable.opening_balance",
        summary=f"Opening balance ₹{payload.amount}",
        entity_type="supplier",
        entity_id=supplier_id,
        actor=user,
    )
    return LedgerEntryRead.model_validate(entry)


@router.post(
    "/suppliers/{supplier_id}/adjustments",
    response_model=LedgerEntryRead,
    status_code=status.HTTP_201_CREATED,
    summary="Correct a supplier balance. A reason is required.",
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def adjust(
    supplier_id: uuid.UUID,
    payload: AdjustmentCreate,
    db: DbSession,
    user: CurrentUser,
) -> LedgerEntryRead:
    entry = await SupplierLedgerService(db).adjust(
        supplier_id=supplier_id,
        amount=payload.amount,
        on_date=payload.entry_date,
        description=payload.description,
        user_id=user.id,
    )
    await AuditService(db).log(
        action="payable.adjusted",
        summary=f"Adjusted supplier balance by ₹{payload.amount}: {payload.description}",
        entity_type="supplier",
        entity_id=supplier_id,
        actor=user,
        changes={"amount": str(payload.amount), "reason": payload.description},
    )
    return LedgerEntryRead.model_validate(entry)


# ---------------------------------------------------------------------------
# Purchase charges — the difference between invoice rate and landed cost
# ---------------------------------------------------------------------------


@router.get(
    "/purchase-orders/{po_id}/charges",
    response_model=list[ChargeRead],
    summary="Freight and other charges on a purchase.",
)
async def list_charges(po_id: uuid.UUID, db: DbSession) -> list[ChargeRead]:
    rows = await db.execute(
        select(PurchaseOrderCharge).where(
            PurchaseOrderCharge.purchase_order_id == po_id
        )
    )
    return [ChargeRead.model_validate(r) for r in rows.scalars().all()]


@router.post(
    "/purchase-orders/{po_id}/charges",
    response_model=ChargeRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add freight, labour, or a deduction to a purchase.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def add_charge(
    po_id: uuid.UUID, payload: ChargeCreate, db: DbSession, user: CurrentUser
) -> ChargeRead:
    """These are what separate the invoice rate from the LANDED cost.

    A bale at ₹40,000 with ₹1,200 of freight really cost ₹41,200, and without
    this the margin on every garment in it is overstated.
    """
    charge = PurchaseOrderCharge(purchase_order_id=po_id, **payload.model_dump())
    db.add(charge)
    await db.flush()
    await AuditService(db).log(
        action="purchase.charge_added",
        summary=f"{'Deduction' if payload.is_deduction else 'Charge'} "
                f"{payload.label} ₹{payload.amount}",
        entity_type="purchase_order",
        entity_id=po_id,
        actor=user,
    )
    return ChargeRead.model_validate(charge)


@router.delete(
    "/purchase-orders/charges/{charge_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a charge.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def remove_charge(charge_id: uuid.UUID, db: DbSession) -> None:
    charge = await db.get(PurchaseOrderCharge, charge_id)
    if charge is not None:
        await db.delete(charge)
        await db.flush()


# ---------------------------------------------------------------------------
# Repricing history
# ---------------------------------------------------------------------------


@router.get(
    "/price-changes",
    response_model=list[PriceChangeRead],
    summary="What was repriced, from what, to what.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def price_changes(
    db: DbSession,
    variant_id: uuid.UUID | None = None,
    limit: int = Query(200, ge=1, le=1000),
) -> list[PriceChangeRead]:
    """The audit log records THAT a product was edited.

    It cannot answer "what did we reprice last month and by how much", which is
    the question actually asked — and the one the outgoing system answered.
    """
    stmt = select(PriceChange).order_by(PriceChange.created_at.desc()).limit(limit)
    if variant_id is not None:
        stmt = stmt.where(PriceChange.variant_id == variant_id)
    rows = await db.execute(stmt)
    return [PriceChangeRead.model_validate(r) for r in rows.scalars().all()]
