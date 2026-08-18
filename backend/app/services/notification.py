"""Notification orchestration.

`publish()` is the single write path:
  1. Persist an in-app Notification row (always — so recipients can see it later).
  2. Fan out to external dispatchers listed in `channels`.
  3. Never raise for expected failures; dispatchers log their own errors.

Rule engine: `evaluate_kind()` walks all active rules for a given kind and
publishes one notification per rule. Background jobs call this.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.core.logging import get_logger
from app.db.models.notification import (
    Notification,
    NotificationChannel,
    NotificationKind,
    NotificationRule,
    NotificationSeverity,
)
from app.db.models.user import User, UserRole
from app.schemas.notification import (
    NotificationCreate,
    NotificationRuleCreate,
    NotificationRuleUpdate,
)
from app.services.notification_dispatchers import (
    DispatchMessage,
    DispatchTarget,
    Dispatcher,
    build_dispatchers,
)

log = get_logger(__name__)


class NotificationService:
    _DISPATCHERS: dict[NotificationChannel, Dispatcher] | None = None

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        if NotificationService._DISPATCHERS is None:
            NotificationService._DISPATCHERS = build_dispatchers()

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------
    async def list_for(
        self,
        user_id: uuid.UUID,
        *,
        page: int = 1,
        page_size: int = 50,
        unread_only: bool = False,
    ) -> tuple[list[Notification], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 1000)
        base = select(Notification).where(
            or_(
                Notification.recipient_user_id == user_id,
                Notification.recipient_user_id.is_(None),
            )
        )
        if unread_only:
            base = base.where(Notification.read_at.is_(None))
        total = await self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = (
            await self.db.scalars(
                base.order_by(Notification.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    async def unread_count(self, user_id: uuid.UUID) -> int:
        stmt = select(func.count(Notification.id)).where(
            or_(
                Notification.recipient_user_id == user_id,
                Notification.recipient_user_id.is_(None),
            ),
            Notification.read_at.is_(None),
        )
        return int(await self.db.scalar(stmt) or 0)

    async def mark_read(
        self, notification_id: uuid.UUID, *, user_id: uuid.UUID
    ) -> Notification:
        row = await self.db.get(Notification, notification_id)
        if row is None:
            raise NotFoundError("Notification not found.", code="NOTIFICATION_NOT_FOUND")
        # Only the addressed recipient (or anyone for broadcasts) can mark it read.
        if row.recipient_user_id and row.recipient_user_id != user_id:
            raise NotFoundError("Notification not found.", code="NOTIFICATION_NOT_FOUND")
        if row.read_at is None:
            row.read_at = datetime.now(timezone.utc)
            await self.db.flush()
        return row

    async def mark_all_read(self, *, user_id: uuid.UUID) -> int:
        stmt = select(Notification).where(
            or_(
                Notification.recipient_user_id == user_id,
                Notification.recipient_user_id.is_(None),
            ),
            Notification.read_at.is_(None),
        )
        rows = (await self.db.scalars(stmt)).all()
        now = datetime.now(timezone.utc)
        for r in rows:
            r.read_at = now
        await self.db.flush()
        return len(rows)

    # ------------------------------------------------------------------
    # Write — the single publish path
    # ------------------------------------------------------------------
    async def publish(
        self,
        *,
        kind: NotificationKind,
        title: str,
        body: str | None = None,
        severity: NotificationSeverity = NotificationSeverity.INFO,
        recipient_user_id: uuid.UUID | None = None,
        channels: Iterable[NotificationChannel | str] = (NotificationChannel.IN_APP,),
        metadata: dict[str, Any] | None = None,
    ) -> Notification:
        chan_values = [
            (c.value if isinstance(c, NotificationChannel) else c) for c in channels
        ]
        # Always include in_app if any channel was requested — it's the persistence layer.
        if NotificationChannel.IN_APP.value not in chan_values:
            chan_values.insert(0, NotificationChannel.IN_APP.value)

        notif = Notification(
            kind=kind,
            severity=severity,
            title=title,
            body=body,
            recipient_user_id=recipient_user_id,
            channels=chan_values,
            metadata_json=metadata or {},
        )
        self.db.add(notif)
        await self.db.flush()

        # Fan out to external channels (best-effort). IN_APP already handled by the row above.
        target = await self._resolve_target(recipient_user_id)
        msg = DispatchMessage(
            title=title, body=body or title, severity=severity.value, kind=kind.value
        )
        for ch_str in chan_values:
            if ch_str == NotificationChannel.IN_APP.value:
                continue
            try:
                channel = NotificationChannel(ch_str)
            except ValueError:
                log.warning("notification.unknown_channel", channel=ch_str)
                continue
            dispatcher = (self._DISPATCHERS or {}).get(channel)
            if dispatcher is None:
                continue
            try:
                await dispatcher.send(target, msg)
            except Exception:  # noqa: BLE001 — dispatch never re-raises
                log.exception("notification.dispatch_failed", channel=channel.value)

        return notif

    async def _resolve_target(
        self, recipient_user_id: uuid.UUID | None
    ) -> DispatchTarget:
        if recipient_user_id is None:
            return DispatchTarget()
        user = await self.db.get(User, recipient_user_id)
        if user is None:
            return DispatchTarget()
        return DispatchTarget(email=user.email, display_name=user.full_name)

    # ------------------------------------------------------------------
    # Rule engine — used by the scheduler
    # ------------------------------------------------------------------
    async def evaluate_kind(
        self,
        kind: NotificationKind,
        *,
        title: str,
        body: str,
        severity: NotificationSeverity = NotificationSeverity.INFO,
        metadata: dict[str, Any] | None = None,
    ) -> list[Notification]:
        """Publish one notification per matching active rule."""
        rules = (
            await self.db.scalars(
                select(NotificationRule).where(
                    NotificationRule.kind == kind,
                    NotificationRule.is_active == True,  # noqa: E712
                )
            )
        ).all()

        published: list[Notification] = []
        for rule in rules:
            if _rank(severity) < _rank(rule.min_severity):
                continue

            recipients = await self._resolve_recipients(rule)
            channels = [NotificationChannel(c) for c in (rule.channels or [])]
            if not channels:
                channels = [NotificationChannel.IN_APP]

            if not recipients:
                # Broadcast — persist a single row with recipient=NULL.
                published.append(
                    await self.publish(
                        kind=kind, title=title, body=body, severity=severity,
                        channels=channels, metadata=metadata,
                    )
                )
                continue

            for user_id in recipients:
                published.append(
                    await self.publish(
                        kind=kind, title=title, body=body, severity=severity,
                        recipient_user_id=user_id, channels=channels, metadata=metadata,
                    )
                )
        return published

    async def _resolve_recipients(self, rule: NotificationRule) -> list[uuid.UUID]:
        if rule.target_user_id is not None:
            return [rule.target_user_id]
        if rule.target_role:
            try:
                role = UserRole(rule.target_role)
            except ValueError:
                log.warning("rule.unknown_role", role=rule.target_role)
                return []
            rows = (
                await self.db.scalars(
                    select(User.id).where(User.role == role, User.is_active == True)  # noqa: E712
                )
            ).all()
            return list(rows)
        return []  # broadcast


def _rank(sev: NotificationSeverity) -> int:
    return {
        NotificationSeverity.INFO: 0,
        NotificationSeverity.WARNING: 1,
        NotificationSeverity.CRITICAL: 2,
    }[sev]


# =============================================================================
# Rule CRUD
# =============================================================================


class NotificationRuleService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, payload: NotificationRuleCreate) -> NotificationRule:
        rule = NotificationRule(
            kind=payload.kind,
            name=payload.name,
            description=payload.description,
            is_active=payload.is_active,
            channels=[c.value for c in payload.channels],
            target_user_id=payload.target_user_id,
            target_role=payload.target_role,
            min_severity=payload.min_severity,
            config=payload.config,
        )
        self.db.add(rule)
        await self.db.flush()
        return rule

    async def get(self, rule_id: uuid.UUID) -> NotificationRule:
        row = await self.db.get(NotificationRule, rule_id)
        if row is None:
            raise NotFoundError("Notification rule not found.", code="RULE_NOT_FOUND")
        return row

    async def list(self) -> list[NotificationRule]:
        rows = (
            await self.db.scalars(
                select(NotificationRule).order_by(
                    NotificationRule.kind, NotificationRule.name
                )
            )
        ).all()
        return list(rows)

    async def update(
        self, rule_id: uuid.UUID, payload: NotificationRuleUpdate
    ) -> NotificationRule:
        rule = await self.get(rule_id)
        data = payload.model_dump(exclude_unset=True)
        if "channels" in data and data["channels"] is not None:
            data["channels"] = [
                c.value if isinstance(c, NotificationChannel) else c
                for c in data["channels"]
            ]
        for k, v in data.items():
            setattr(rule, k, v)
        await self.db.flush()
        return rule

    async def delete(self, rule_id: uuid.UUID) -> None:
        rule = await self.get(rule_id)
        await self.db.delete(rule)
        await self.db.flush()
