"""Notifications + notification rules.

Notifications are persisted in DB so an in-app inbox can survive restarts.
Delivery to external channels (email, WhatsApp, push) is handled by
`app.services.notification_dispatchers` — separated so future channels drop
in without changing the storage layer.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any, TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    JSON,
    String,
    Text,
    TypeDecorator,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin, UtcDateTime

if TYPE_CHECKING:
    from app.db.models.user import User


class NotificationKind(str, Enum):
    """The event type that produced the notification. Rules key off this."""

    LOW_STOCK = "low_stock"
    OUT_OF_STOCK = "out_of_stock"
    PENDING_DAY_CLOSE = "pending_day_close"
    DAILY_SUMMARY = "daily_summary"
    COMMISSION_READY = "commission_ready"
    EXPENSE_SUBMITTED = "expense_submitted"
    EXPENSE_APPROVED = "expense_approved"
    CUSTOM = "custom"


class NotificationSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class NotificationChannel(str, Enum):
    IN_APP = "in_app"
    EMAIL = "email"
    WHATSAPP = "whatsapp"
    PUSH = "push"


class _KindType(TypeDecorator):
    impl = String(32)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, NotificationKind):
            return value.value
        return NotificationKind(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        return None if value is None else NotificationKind(value)


class _SeverityType(TypeDecorator):
    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, NotificationSeverity):
            return value.value
        return NotificationSeverity(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        return None if value is None else NotificationSeverity(value)


class Notification(UUIDPKMixin, TimestampMixin, Base):
    """A single delivered notification (in-app record).

    `recipient_user_id` is nullable: NULL means "broadcast to anyone with the
    required role", enforced at the API layer via role-scoped read filters.
    """

    __tablename__ = "notifications"

    kind: Mapped[NotificationKind] = mapped_column(_KindType(), nullable=False, index=True)
    severity: Mapped[NotificationSeverity] = mapped_column(
        _SeverityType(), nullable=False, default=NotificationSeverity.INFO, index=True
    )

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)

    # NULL = broadcast to everyone with the appropriate role for the kind.
    recipient_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Delivered-to channels (audit trail). E.g. ["in_app", "email"].
    channels: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)

    # Free-form context (e.g. {"variant_id": "...", "on_hand": "2"}).
    metadata_json: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSON, nullable=False, default=dict
    )

    read_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)

    recipient: Mapped["User | None"] = relationship("User")


class NotificationRule(UUIDPKMixin, TimestampMixin, Base):
    """Configurable trigger — background jobs check active rules and emit notifications.

    `config` is a JSON blob whose shape depends on `kind`:
      - LOW_STOCK: {} (no config — uses variant.reorder_point per line)
      - PENDING_DAY_CLOSE: {"after_hour": 22} (local hour of day)
      - Others: {} for now.
    """

    __tablename__ = "notification_rules"

    kind: Mapped[NotificationKind] = mapped_column(_KindType(), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Comma-list of channels this rule broadcasts on. Stored as JSON list.
    channels: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)

    # Delivery targeting.
    # NULL user + NULL role = every user of the min role gets it.
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Min role that receives the broadcast when target_user_id is NULL.
    target_role: Mapped[str | None] = mapped_column(String(32), nullable=True)

    min_severity: Mapped[NotificationSeverity] = mapped_column(
        _SeverityType(), nullable=False, default=NotificationSeverity.INFO
    )

    config: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
