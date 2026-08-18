"""Coupon endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbSession, require_min_role
from app.db.models.user import UserRole
from app.schemas.common import Page
from app.schemas.coupon import (
    CouponCreate,
    CouponRead,
    CouponUpdate,
    CouponValidateRequest,
    CouponValidateResponse,
)
from app.services.coupon import CouponService

router = APIRouter(prefix="/coupons", tags=["coupons"])


@router.get(
    "",
    response_model=Page[CouponRead],
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_coupons(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    is_active: bool | None = None,
) -> Page[CouponRead]:
    rows, total = await CouponService(db).list(
        page=page, page_size=page_size, is_active=is_active
    )
    return Page[CouponRead](
        items=[CouponRead.model_validate(c) for c in rows],
        total=total, page=page, page_size=page_size,
    )


@router.post(
    "",
    response_model=CouponRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def create_coupon(payload: CouponCreate, db: DbSession) -> CouponRead:
    return CouponRead.model_validate(await CouponService(db).create(payload))


@router.get(
    "/{coupon_id}",
    response_model=CouponRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def get_coupon(coupon_id: uuid.UUID, db: DbSession) -> CouponRead:
    return CouponRead.model_validate(await CouponService(db).get(coupon_id))


@router.patch(
    "/{coupon_id}",
    response_model=CouponRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def update_coupon(
    coupon_id: uuid.UUID, payload: CouponUpdate, db: DbSession
) -> CouponRead:
    return CouponRead.model_validate(await CouponService(db).update(coupon_id, payload))


@router.delete(
    "/{coupon_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def delete_coupon(coupon_id: uuid.UUID, db: DbSession) -> None:
    await CouponService(db).delete(coupon_id)


@router.post(
    "/validate",
    response_model=CouponValidateResponse,
    summary="Check a coupon against a bill amount + customer; returns computed discount.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def validate_coupon(
    payload: CouponValidateRequest, db: DbSession
) -> CouponValidateResponse:
    return await CouponService(db).validate(payload)
