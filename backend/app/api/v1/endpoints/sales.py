"""Sale (invoice) endpoints."""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    CurrentUser,
    DbSession,
    assert_store_access,
    require_elevation,
    require_min_role,
)
from app.db.models.sale import SaleStatus
from app.db.models.user import UserRole
from app.schemas.common import Page
from app.schemas.sale import (
    AdvanceCreate,
    CustomerBalance,
    SaleCreate,
    SaleLineReturnable,
    SalePaymentCollect,
    SaleRead,
    SaleReturnCreate,
    SaleSummary,
    SaleVoidRequest,
)
from app.services.audit import AuditService
from app.services.sale import SaleService

router = APIRouter(prefix="/sales", tags=["sales"])


@router.get(
    "",
    response_model=Page[SaleSummary],
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_sales(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    store_id: uuid.UUID | None = None,
    customer_id: uuid.UUID | None = None,
    search: str | None = Query(
        None,
        description=(
            "Invoice number, customer phone, or customer name. Phone matching "
            "ignores spaces, dashes and brackets — a customer who returns "
            "without their bill gives a number, not a format."
        ),
    ),
    status_filter: SaleStatus | None = Query(None, alias="status"),
    from_date: date | None = None,
    to_date: date | None = None,
) -> Page[SaleSummary]:
    rows, total = await SaleService(db).list(
        store_id=store_id,
        customer_id=customer_id,
        search=search,
        status=status_filter,
        from_date=from_date,
        to_date=to_date,
        page=page,
        page_size=page_size,
    )
    return Page[SaleSummary](items=rows, total=total, page=page, page_size=page_size)


@router.post(
    "",
    response_model=SaleRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def create_sale(
    payload: SaleCreate, db: DbSession, user: CurrentUser
) -> SaleRead:
    # A cashier assigned to one branch must not raise a bill under the other
    # branch's GSTIN. The store picker lists every store, so this is one wrong
    # click away without the check.
    assert_store_access(user, payload.store_id)
    sale = await SaleService(db).create(payload, user_id=user.id)
    await AuditService(db).log(
        action="sale.create",
        summary=f"Rang up {sale.number} for ₹{sale.grand_total}",
        entity_type="sale",
        entity_id=sale.id,
        actor=user,
        changes={
            "grand_total": str(sale.grand_total),
            "line_count": len(sale.lines),
            "store_id": str(sale.store_id),
        },
    )
    return SaleRead.model_validate(sale)


@router.get(
    "/{sale_id}",
    response_model=SaleRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def get_sale(sale_id: uuid.UUID, db: DbSession) -> SaleRead:
    return SaleRead.model_validate(await SaleService(db).get(sale_id))


@router.post(
    "/{sale_id}/payments",
    response_model=SaleRead,
    summary="Collect a payment against an outstanding (due) bill.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def collect_sale_payment(
    sale_id: uuid.UUID,
    payload: SalePaymentCollect,
    db: DbSession,
    user: CurrentUser,
) -> SaleRead:
    sale = await SaleService(db).add_payment(
        sale_id,
        method=payload.method,
        amount=payload.amount,
        reference=payload.reference,
        user_id=user.id,
    )
    await AuditService(db).log(
        action="sale.payment.collect",
        summary=f"Collected ₹{payload.amount} on {sale.number}",
        entity_type="sale",
        entity_id=sale.id,
        actor=user,
        changes={
            "amount": str(payload.amount),
            "method": payload.method.value,
            "balance_after": str(sale.balance_due),
        },
    )
    return SaleRead.model_validate(sale)


@router.post(
    "/{sale_id}/void",
    response_model=SaleRead,
    summary="Void a completed sale — reverses stock movements.",
    # Password-gated with the deletes. Voiding is the most consequential thing
    # anyone can do from the till: it reverses stock AND removes takings from
    # the day's figures, which is precisely the shape of an inside loss.
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.MANAGER))],
)
async def void_sale(
    sale_id: uuid.UUID,
    payload: SaleVoidRequest,
    db: DbSession,
    user: CurrentUser,
) -> SaleRead:
    sale = await SaleService(db).void(sale_id, reason=payload.reason, user_id=user.id)
    await AuditService(db).log(
        action="sale.void",
        summary=f"Voided {sale.number} (₹{sale.grand_total}): {payload.reason}",
        entity_type="sale",
        entity_id=sale.id,
        actor=user,
        changes={"reason": payload.reason},
    )
    return SaleRead.model_validate(sale)


@router.post(
    "/{sale_id}/printed",
    response_model=SaleRead,
    summary="Record that this bill was printed. Later copies are duplicates.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def mark_printed(sale_id: uuid.UUID, db: DbSession) -> SaleRead:
    """Count the prints so a reprint can be MARKED as one.

    Two identical-looking copies of one invoice is how a bill gets paid twice,
    or a return processed against a copy while the original still stands. The
    count is the only thing that lets the paper say which is which.

    Not gated: printing is not a privileged act, and a cashier whose printer
    jammed must be able to run it again without finding a manager.
    """
    sale = await SaleService(db).get(sale_id)
    sale.print_count = (sale.print_count or 0) + 1
    await db.flush()
    return SaleRead.model_validate(sale)


@router.get(
    "/{sale_id}/returnable",
    response_model=list[SaleLineReturnable],
    summary="How much of each line on this bill can still be credited.",
)
async def returnable_lines(sale_id: uuid.UUID, db: DbSession) -> list[SaleLineReturnable]:
    return await SaleService(db).returnable_lines(sale_id)


@router.post(
    "/{sale_id}/returns",
    response_model=SaleRead,
    status_code=status.HTTP_201_CREATED,
    summary="Credit part or all of a bill — puts stock back and refunds money.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def create_return(
    sale_id: uuid.UUID,
    payload: SaleReturnCreate,
    db: DbSession,
    user: CurrentUser,
) -> SaleRead:
    """A return is recorded as a credit note: a sale row with negative money.

    The service audits it against the original invoice, so no second audit call
    is made here — one action, one entry.
    """
    credit = await SaleService(db).create_return(sale_id, payload, user_id=user.id)
    return SaleRead.model_validate(credit)


@router.post(
    "/advances",
    response_model=SaleRead,
    status_code=status.HTTP_201_CREATED,
    summary="Record money taken before goods are given.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def create_advance(
    payload: AdvanceCreate, db: DbSession, user: CurrentUser
) -> SaleRead:
    """An advance is not revenue — nothing has been delivered.

    It is stored with no lines, grand_total 0, and a NEGATIVE balance_due, so
    the shop's books show it as money held against future goods rather than as
    a sale. The service audits it; no second entry is written here.
    """
    assert_store_access(user, payload.store_id)
    advance = await SaleService(db).create_advance(payload, user_id=user.id)
    return SaleRead.model_validate(advance)


@router.get(
    "/customers/{customer_id}/balance",
    response_model=CustomerBalance,
    summary="What this customer owes, and what the shop holds for them.",
)
async def customer_balance(customer_id: uuid.UUID, db: DbSession) -> CustomerBalance:
    return await SaleService(db).customer_balance(customer_id)
