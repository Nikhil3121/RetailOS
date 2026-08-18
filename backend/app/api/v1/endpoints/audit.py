"""Audit-log + dashboard-layout endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query

from app.api.deps import CurrentUser, DbSession, require_min_role
from app.db.models.user import UserRole
from app.schemas.audit import (
    AuditLogRead,
    DashboardLayoutRead,
    DashboardLayoutSave,
)
from app.schemas.common import Page
from app.services.audit import AuditService, DashboardLayoutService


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

audit_router = APIRouter(prefix="/audit-logs", tags=["audit"])


@audit_router.get(
    "",
    response_model=Page[AuditLogRead],
    summary="Filter the audit log — by action, entity, actor, or free-text search.",
    dependencies=[Depends(require_min_role(UserRole.OWNER))],
)
async def list_audit(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    action: str | None = Query(None),
    entity_type: str | None = Query(None),
    entity_id: uuid.UUID | None = Query(None),
    actor_user_id: uuid.UUID | None = Query(None),
    search: str | None = Query(None),
) -> Page[AuditLogRead]:
    rows, total = await AuditService(db).list(
        page=page,
        page_size=page_size,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        actor_user_id=actor_user_id,
        search=search,
    )
    return Page[AuditLogRead](
        items=[AuditLogRead.model_validate(r) for r in rows],
        total=total, page=page, page_size=page_size,
    )


# ---------------------------------------------------------------------------
# Dashboard layout (per-user)
# ---------------------------------------------------------------------------

layout_router = APIRouter(prefix="/dashboard-layout", tags=["dashboard"])


@layout_router.get(
    "",
    response_model=DashboardLayoutRead,
    summary="Return the caller's saved dashboard layout, or an empty layout if none saved yet.",
)
async def get_layout(db: DbSession, user: CurrentUser) -> DashboardLayoutRead:
    row = await DashboardLayoutService(db).get_for(user.id)
    return DashboardLayoutRead.model_validate(row)


@layout_router.put(
    "",
    response_model=DashboardLayoutRead,
    summary="Replace the caller's saved dashboard layout.",
)
async def save_layout(
    payload: DashboardLayoutSave, db: DbSession, user: CurrentUser
) -> DashboardLayoutRead:
    row = await DashboardLayoutService(db).save_for(user.id, payload.layout)
    return DashboardLayoutRead.model_validate(row)
