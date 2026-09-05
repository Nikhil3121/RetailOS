"""User CRUD endpoints. Administered by Owner+ (Manager may view only)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import CurrentUser, DbSession, require_elevation, require_min_role
from app.db.models.user import UserRole
from app.schemas.common import Page
from app.schemas.user import UserCreate, UserRead, UserUpdate
from app.services.audit import AuditService
from app.services.user import UserService

router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "",
    response_model=Page[UserRead],
    summary="List users",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def list_users(
    db: DbSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=1000),
) -> Page[UserRead]:
    rows, total = await UserService(db).list(page=page, page_size=page_size)
    return Page[UserRead](
        items=[UserRead.model_validate(u) for u in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/by-staff-code/{code}",
    response_model=UserRead,
    summary="Look up a user by staff_code (used by the Billing quick-entry).",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def get_by_staff_code(code: str, db: DbSession) -> UserRead:
    from app.core.exceptions import NotFoundError as _NF

    user = await UserService(db).get_by_staff_code(code)
    if user is None:
        raise _NF("No staff member has that code.", code="STAFF_CODE_NOT_FOUND")
    return UserRead.model_validate(user)


@router.post(
    "",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a user",
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def create_user(
    payload: UserCreate, db: DbSession, actor: CurrentUser
) -> UserRead:
    user = await UserService(db).create(payload)
    await AuditService(db).log(
        action="user.create",
        summary=f"Created user {user.email} ({user.role.value})",
        entity_type="user",
        entity_id=user.id,
        actor=actor,
        changes={"email": user.email, "role": user.role.value},
    )
    return UserRead.model_validate(user)


@router.get(
    "/{user_id}",
    response_model=UserRead,
    summary="Fetch a single user",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def get_user(user_id: uuid.UUID, db: DbSession) -> UserRead:
    user = await UserService(db).get(user_id)
    return UserRead.model_validate(user)


@router.patch(
    "/{user_id}",
    response_model=UserRead,
    summary="Update a user",
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def update_user(
    user_id: uuid.UUID, payload: UserUpdate, db: DbSession, actor: CurrentUser
) -> UserRead:
    user = await UserService(db).update(user_id, payload)
    await AuditService(db).log(
        action="user.update",
        summary=f"Updated user {user.email}",
        entity_type="user",
        entity_id=user.id,
        actor=actor,
        changes=payload.model_dump(exclude_unset=True, mode="json"),
    )
    return UserRead.model_validate(user)


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a user",
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.OWNER))],
)
async def delete_user(
    user_id: uuid.UUID, db: DbSession, actor: CurrentUser
) -> None:
    user = await UserService(db).get(user_id)
    victim_email = user.email
    await UserService(db).delete(user_id)
    await AuditService(db).log(
        action="user.delete",
        summary=f"Deleted user {victim_email}",
        entity_type="user",
        entity_id=user_id,
        actor=actor,
    )
