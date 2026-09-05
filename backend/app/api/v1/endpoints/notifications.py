"""Notification inbox + rule CRUD + ad-hoc publish."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import CurrentUser, DbSession, require_elevation, require_min_role
from app.db.models.user import UserRole
from app.schemas.common import Page
from app.schemas.notification import (
    NotificationCreate,
    NotificationRead,
    NotificationRuleCreate,
    NotificationRuleRead,
    NotificationRuleUpdate,
    NotificationUnreadCount,
)
from app.services.notification import NotificationRuleService, NotificationService

router = APIRouter(prefix="/notifications", tags=["notifications"])


# ---------------------------------------------------------------------------
# Inbox
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=Page[NotificationRead],
    summary="Notifications for the caller — personal + broadcasts.",
)
async def list_mine(
    db: DbSession,
    user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    unread_only: bool = False,
) -> Page[NotificationRead]:
    rows, total = await NotificationService(db).list_for(
        user.id, page=page, page_size=page_size, unread_only=unread_only,
    )
    return Page[NotificationRead](
        items=[NotificationRead.model_validate(r) for r in rows],
        total=total, page=page, page_size=page_size,
    )


@router.get(
    "/unread-count",
    response_model=NotificationUnreadCount,
    summary="Number of unread notifications for the caller. Poll-friendly.",
)
async def unread_count(db: DbSession, user: CurrentUser) -> NotificationUnreadCount:
    return NotificationUnreadCount(
        unread=await NotificationService(db).unread_count(user.id)
    )


@router.post(
    "/{notification_id}/read",
    response_model=NotificationRead,
)
async def mark_read(
    notification_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> NotificationRead:
    row = await NotificationService(db).mark_read(notification_id, user_id=user.id)
    return NotificationRead.model_validate(row)


@router.post(
    "/read-all",
    response_model=NotificationUnreadCount,
    summary="Mark every unread notification for the caller as read.",
)
async def mark_all_read(db: DbSession, user: CurrentUser) -> NotificationUnreadCount:
    await NotificationService(db).mark_all_read(user_id=user.id)
    return NotificationUnreadCount(unread=0)


@router.post(
    "",
    response_model=NotificationRead,
    status_code=status.HTTP_201_CREATED,
    summary="Publish an ad-hoc notification.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def publish(
    payload: NotificationCreate, db: DbSession
) -> NotificationRead:
    svc = NotificationService(db)
    row = await svc.publish(
        kind=payload.kind,
        title=payload.title,
        body=payload.body,
        severity=payload.severity,
        recipient_user_id=payload.recipient_user_id,
        channels=payload.channels,
        metadata=payload.metadata,
    )
    return NotificationRead.model_validate(row)


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------


@router.get(
    "/rules",
    response_model=list[NotificationRuleRead],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def list_rules(db: DbSession) -> list[NotificationRuleRead]:
    rows = await NotificationRuleService(db).list()
    return [NotificationRuleRead.model_validate(r) for r in rows]


@router.post(
    "/rules",
    response_model=NotificationRuleRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def create_rule(
    payload: NotificationRuleCreate, db: DbSession
) -> NotificationRuleRead:
    return NotificationRuleRead.model_validate(
        await NotificationRuleService(db).create(payload)
    )


@router.patch(
    "/rules/{rule_id}",
    response_model=NotificationRuleRead,
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def update_rule(
    rule_id: uuid.UUID, payload: NotificationRuleUpdate, db: DbSession
) -> NotificationRuleRead:
    return NotificationRuleRead.model_validate(
        await NotificationRuleService(db).update(rule_id, payload)
    )


@router.delete(
    "/rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.OWNER))],
)
async def delete_rule(rule_id: uuid.UUID, db: DbSession) -> None:
    await NotificationRuleService(db).delete(rule_id)
