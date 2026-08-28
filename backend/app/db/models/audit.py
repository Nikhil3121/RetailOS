"""Append-only audit log + per-user dashboard layout."""

from __future__ import annotations

import uuid
from typing import Any, TYPE_CHECKING

from sqlalchemy import ForeignKey, JSON, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from app.db.models.user import User


class AuditLog(UUIDPKMixin, TimestampMixin, Base):
    """One row per interesting action.

    - `action` is a short slug like `"sale.create"`, `"user.login"` — grep-friendly.
    - `entity_type` + `entity_id` are optional; use them when the action targets a row
      you'd want a "history for this record" view of.
    - `changes` is free-form JSON — before/after diffs, IP, extra context. Never PII.
    """

    __tablename__ = "audit_logs"

    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_type: Mapped[str | None] = mapped_column(String(48), nullable=True, index=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), nullable=True, index=True
    )

    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    actor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)

    summary: Mapped[str] = mapped_column(String(255), nullable=False)
    changes: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    actor: Mapped["User | None"] = relationship("User")


class UserDashboardLayout(UUIDPKMixin, TimestampMixin, Base):
    """One row per user.

    `layout` is a JSON blob owned by the frontend — the backend never introspects
    it. Shape today: `{"hidden": ["chart-row"], "order": ["kpi-row-1", ...]}`.
    Change the shape any time; the backend just stores + returns.
    """

    __tablename__ = "user_dashboard_layouts"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_user_dashboard_layouts_user_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    layout: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
