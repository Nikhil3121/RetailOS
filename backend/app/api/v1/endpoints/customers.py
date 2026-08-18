"""Customer endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbSession, require_min_role
from app.db.models.user import UserRole
from app.schemas.common import Page
from app.schemas.customer import CustomerCreate, CustomerRead, CustomerUpdate
from app.schemas.timeline import TimelinePayload
from app.services.customer import CustomerService
from app.services.timeline import TimelineService

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get(
    "",
    response_model=Page[CustomerRead],
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_customers(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    search: str | None = Query(None),
) -> Page[CustomerRead]:
    rows, total = await CustomerService(db).list(page=page, page_size=page_size, search=search)
    return Page[CustomerRead](
        items=[CustomerRead.model_validate(c) for c in rows],
        total=total, page=page, page_size=page_size,
    )


@router.post(
    "",
    response_model=CustomerRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def create_customer(payload: CustomerCreate, db: DbSession) -> CustomerRead:
    return CustomerRead.model_validate(await CustomerService(db).create(payload))


@router.get(
    "/{customer_id}",
    response_model=CustomerRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def get_customer(customer_id: uuid.UUID, db: DbSession) -> CustomerRead:
    return CustomerRead.model_validate(await CustomerService(db).get(customer_id))


@router.patch(
    "/{customer_id}",
    response_model=CustomerRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def update_customer(
    customer_id: uuid.UUID, payload: CustomerUpdate, db: DbSession
) -> CustomerRead:
    return CustomerRead.model_validate(await CustomerService(db).update(customer_id, payload))


@router.delete(
    "/{customer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def delete_customer(customer_id: uuid.UUID, db: DbSession) -> None:
    await CustomerService(db).delete(customer_id)


@router.get(
    "/{customer_id}/timeline",
    response_model=TimelinePayload,
    summary="Merged feed of sales and coupon redemptions.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def customer_timeline(
    customer_id: uuid.UUID,
    db: DbSession,
    limit: int = Query(100, ge=1, le=500),
) -> TimelinePayload:
    return await TimelineService(db).build(customer_id, limit=limit)
