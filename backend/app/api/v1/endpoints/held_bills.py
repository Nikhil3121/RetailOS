"""Parked carts, shared across the tills of one branch."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, assert_store_access, require_min_role
from app.core.exceptions import NotFoundError
from app.db.models.held_bill import HeldBill
from app.db.models.user import UserRole
from app.schemas.common import ORMModel

router = APIRouter(prefix="/held-bills", tags=["held-bills"])


class HeldBillCreate(BaseModel):
    store_id: uuid.UUID
    customer_id: uuid.UUID | None = None
    salesperson_user_id: uuid.UUID | None = None
    label: str | None = Field(
        default=None,
        max_length=128,
        description="How the counter identifies it — 'blue saree lady', 'Sharma ji'.",
    )
    notes: str | None = None
    cart: dict[str, Any] = Field(
        description="The cart verbatim. Not a sale: no number, no stock, no money."
    )
    terminal_uuid: str | None = Field(default=None, max_length=64)


class HeldBillRead(ORMModel):
    id: uuid.UUID
    store_id: uuid.UUID
    customer_id: uuid.UUID | None
    salesperson_user_id: uuid.UUID | None
    label: str | None
    notes: str | None
    cart: dict[str, Any]
    held_by_user_id: uuid.UUID | None
    terminal_uuid: str | None
    created_at: datetime


@router.get(
    "",
    response_model=list[HeldBillRead],
    summary="Every parked cart at this branch, newest first.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_held(
    db: DbSession,
    store_id: uuid.UUID = Query(..., description="Held bills are per branch."),
) -> list[HeldBillRead]:
    rows = await db.execute(
        select(HeldBill)
        .where(HeldBill.store_id == store_id)
        .order_by(HeldBill.created_at.desc())
    )
    return [HeldBillRead.model_validate(r) for r in rows.scalars().all()]


@router.post(
    "",
    response_model=HeldBillRead,
    status_code=status.HTTP_201_CREATED,
    summary="Park a cart so any till in this branch can finish it.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def hold(
    payload: HeldBillCreate, db: DbSession, user: CurrentUser
) -> HeldBillRead:
    assert_store_access(user, payload.store_id)
    held = HeldBill(**payload.model_dump(), held_by_user_id=user.id)
    db.add(held)
    await db.flush()
    return HeldBillRead.model_validate(held)


@router.delete(
    "/{held_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Discard a parked cart, or clear it once it has been billed.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def discard(held_id: uuid.UUID, db: DbSession, user: CurrentUser) -> None:
    """Deliberately NOT password-gated.

    Nothing of value is lost: a held bill has no invoice number, no stock
    movement and no money. Requiring a password to clear a resumed cart would
    put friction on the busiest moment of the day for no protection at all.
    """
    held = await db.get(HeldBill, held_id)
    if held is None:
        raise NotFoundError("That parked bill is no longer there.",
                            code="HELD_BILL_NOT_FOUND")
    assert_store_access(user, held.store_id)
    await db.delete(held)
    await db.flush()
