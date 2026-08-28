"""Audit-log writer + reader + dashboard-layout persistence.

`AuditService.log()` is the sole write path. It accepts a live DB session so
the log row commits inside the caller's transaction — if the domain operation
rolls back, so does the audit row. That keeps the two consistent.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.audit import AuditLog, UserDashboardLayout
from app.db.models.user import User


class AuditService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------
    async def log(
        self,
        *,
        action: str,
        summary: str,
        entity_type: str | None = None,
        entity_id: uuid.UUID | None = None,
        actor: User | None = None,
        actor_email: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        changes: dict[str, Any] | None = None,
    ) -> AuditLog:
        row = AuditLog(
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            actor_user_id=actor.id if actor else None,
            actor_email=(actor.email if actor else actor_email),
            ip_address=ip_address,
            user_agent=(user_agent[:512] if user_agent else None),
            summary=summary[:255],
            changes=changes or {},
        )
        self.db.add(row)
        await self.db.flush()
        return row

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------
    async def list(
        self,
        *,
        page: int = 1,
        page_size: int = 100,
        action: str | None = None,
        entity_type: str | None = None,
        entity_id: uuid.UUID | None = None,
        actor_user_id: uuid.UUID | None = None,
        search: str | None = None,
    ) -> tuple[list[AuditLog], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 500)
        base = select(AuditLog)
        if action:
            base = base.where(AuditLog.action == action)
        if entity_type:
            base = base.where(AuditLog.entity_type == entity_type)
        if entity_id is not None:
            base = base.where(AuditLog.entity_id == entity_id)
        if actor_user_id is not None:
            base = base.where(AuditLog.actor_user_id == actor_user_id)
        if search:
            like = f"%{search.strip()}%"
            base = base.where(
                or_(
                    AuditLog.summary.ilike(like),
                    AuditLog.action.ilike(like),
                    AuditLog.actor_email.ilike(like),
                )
            )

        total = await self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = (
            await self.db.scalars(
                base.order_by(AuditLog.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)


# =============================================================================
# Dashboard layout
# =============================================================================


class DashboardLayoutService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_for(self, user_id: uuid.UUID) -> UserDashboardLayout:
        row = await self.db.scalar(
            select(UserDashboardLayout).where(UserDashboardLayout.user_id == user_id)
        )
        if row is None:
            row = UserDashboardLayout(user_id=user_id, layout={})
            self.db.add(row)
            await self.db.flush()
        return row

    async def save_for(
        self, user_id: uuid.UUID, layout: dict[str, Any]
    ) -> UserDashboardLayout:
        row = await self.get_for(user_id)
        row.layout = layout
        await self.db.flush()
        return row
