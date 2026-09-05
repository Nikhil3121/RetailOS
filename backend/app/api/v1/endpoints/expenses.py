"""Expense CRUD + workflow + report endpoints."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import CurrentUser, DbSession, require_elevation, require_min_role
from app.db.models.expense import ExpenseStatus
from app.db.models.user import UserRole
from app.schemas.common import Page
from app.schemas.expense import (
    ExpenseByCategoryRow,
    ExpenseCategoryCreate,
    ExpenseCategoryRead,
    ExpenseCategoryUpdate,
    ExpenseCreate,
    ExpenseRead,
    ExpenseRejectRequest,
    ExpenseSummary,
    ExpenseTrendPoint,
    ExpenseUpdate,
    PnLReport,
)
from app.services.audit import AuditService
from app.services.expense import (
    ExpenseCategoryService,
    ExpenseReportService,
    ExpenseService,
)

router = APIRouter(prefix="/expenses", tags=["expenses"])


def _default_range() -> tuple[date, date]:
    today = date.today()
    return today - timedelta(days=29), today


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


@router.get(
    "/categories",
    response_model=Page[ExpenseCategoryRead],
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_categories(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    is_active: bool | None = None,
) -> Page[ExpenseCategoryRead]:
    rows, total = await ExpenseCategoryService(db).list(
        page=page, page_size=page_size, is_active=is_active
    )
    return Page[ExpenseCategoryRead](
        items=[ExpenseCategoryRead.model_validate(r) for r in rows],
        total=total, page=page, page_size=page_size,
    )


@router.post(
    "/categories",
    response_model=ExpenseCategoryRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def create_category(
    payload: ExpenseCategoryCreate, db: DbSession
) -> ExpenseCategoryRead:
    return ExpenseCategoryRead.model_validate(
        await ExpenseCategoryService(db).create(payload)
    )


@router.patch(
    "/categories/{cat_id}",
    response_model=ExpenseCategoryRead,
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def update_category(
    cat_id: uuid.UUID, payload: ExpenseCategoryUpdate, db: DbSession
) -> ExpenseCategoryRead:
    return ExpenseCategoryRead.model_validate(
        await ExpenseCategoryService(db).update(cat_id, payload)
    )


@router.delete(
    "/categories/{cat_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.OWNER))],
)
async def delete_category(cat_id: uuid.UUID, db: DbSession) -> None:
    await ExpenseCategoryService(db).delete(cat_id)


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=Page[ExpenseRead],
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_expenses(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    status_filter: ExpenseStatus | None = Query(None, alias="status"),
    store_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> Page[ExpenseRead]:
    rows, total = await ExpenseService(db).list(
        status=status_filter,
        store_id=store_id,
        category_id=category_id,
        from_date=from_date,
        to_date=to_date,
        page=page,
        page_size=page_size,
    )
    return Page[ExpenseRead](
        items=[ExpenseRead.model_validate(r) for r in rows],
        total=total, page=page, page_size=page_size,
    )


@router.post(
    "",
    response_model=ExpenseRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def create_expense(
    payload: ExpenseCreate, db: DbSession, user: CurrentUser
) -> ExpenseRead:
    return ExpenseRead.model_validate(
        await ExpenseService(db).create(payload, user_id=user.id)
    )


@router.get(
    "/{expense_id}",
    response_model=ExpenseRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def get_expense(expense_id: uuid.UUID, db: DbSession) -> ExpenseRead:
    return ExpenseRead.model_validate(await ExpenseService(db).get(expense_id))


@router.patch(
    "/{expense_id}",
    response_model=ExpenseRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def update_expense(
    expense_id: uuid.UUID, payload: ExpenseUpdate, db: DbSession
) -> ExpenseRead:
    return ExpenseRead.model_validate(
        await ExpenseService(db).update(expense_id, payload)
    )


@router.delete(
    "/{expense_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.CASHIER))],
)
async def delete_expense(expense_id: uuid.UUID, db: DbSession) -> None:
    await ExpenseService(db).delete(expense_id)


@router.post(
    "/{expense_id}/submit",
    response_model=ExpenseRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def submit_expense(
    expense_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> ExpenseRead:
    return ExpenseRead.model_validate(
        await ExpenseService(db).submit(expense_id, user_id=user.id)
    )


@router.post(
    "/{expense_id}/approve",
    response_model=ExpenseRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def approve_expense(
    expense_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> ExpenseRead:
    expense = await ExpenseService(db).approve(expense_id, user_id=user.id)
    await AuditService(db).log(
        action="expense.approve",
        summary=f"Approved {expense.number} for ₹{expense.grand_total}",
        entity_type="expense",
        entity_id=expense.id,
        actor=user,
    )
    return ExpenseRead.model_validate(expense)


@router.post(
    "/{expense_id}/reject",
    response_model=ExpenseRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def reject_expense(
    expense_id: uuid.UUID,
    payload: ExpenseRejectRequest,
    db: DbSession,
    user: CurrentUser,
) -> ExpenseRead:
    expense = await ExpenseService(db).reject(
        expense_id, reason=payload.reason, user_id=user.id
    )
    await AuditService(db).log(
        action="expense.reject",
        summary=f"Rejected {expense.number}: {payload.reason}",
        entity_type="expense",
        entity_id=expense.id,
        actor=user,
        changes={"reason": payload.reason},
    )
    return ExpenseRead.model_validate(expense)


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


@router.get(
    "/reports/summary",
    response_model=ExpenseSummary,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def expense_summary(
    db: DbSession,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    store_id: uuid.UUID | None = None,
) -> ExpenseSummary:
    default = _default_range()
    return await ExpenseReportService(db).summary(
        from_date=from_date or default[0],
        to_date=to_date or default[1],
        store_id=store_id,
    )


@router.get(
    "/reports/by-category",
    response_model=list[ExpenseByCategoryRow],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def expenses_by_category(
    db: DbSession,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    store_id: uuid.UUID | None = None,
) -> list[ExpenseByCategoryRow]:
    default = _default_range()
    return await ExpenseReportService(db).by_category(
        from_date=from_date or default[0],
        to_date=to_date or default[1],
        store_id=store_id,
    )


@router.get(
    "/reports/trend",
    response_model=list[ExpenseTrendPoint],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def expense_trend(
    db: DbSession,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    store_id: uuid.UUID | None = None,
) -> list[ExpenseTrendPoint]:
    default = _default_range()
    return await ExpenseReportService(db).trend(
        from_date=from_date or default[0],
        to_date=to_date or default[1],
        store_id=store_id,
    )


@router.get(
    "/reports/pnl",
    response_model=PnLReport,
    summary="Profit & Loss — revenue − COGS − operating expenses.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def pnl_report(
    db: DbSession,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    store_id: uuid.UUID | None = None,
) -> PnLReport:
    default = _default_range()
    return await ExpenseReportService(db).pnl(
        from_date=from_date or default[0],
        to_date=to_date or default[1],
        store_id=store_id,
    )
