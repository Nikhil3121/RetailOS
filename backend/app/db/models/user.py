"""User + refresh-token ORM models.

Roles are stored as an enum-backed string column so the database stays readable
and grep-friendly. `UserRole.priority()` establishes the hierarchy used by RBAC
dependencies (higher number = greater privilege).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING

from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    TypeDecorator,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin, UtcDateTime

if TYPE_CHECKING:
    from app.db.models.store import Store


class UserRole(str, Enum):
    SUPER_ADMIN = "super_admin"
    OWNER = "owner"
    MANAGER = "manager"
    CASHIER = "cashier"
    STAFF = "staff"

    def priority(self) -> int:
        """Higher priority ⇒ more privilege. Used for `require_role(min=...)` checks."""
        return {
            UserRole.STAFF: 10,
            UserRole.CASHIER: 20,
            UserRole.MANAGER: 40,
            UserRole.OWNER: 80,
            UserRole.SUPER_ADMIN: 100,
        }[self]


class _UserRoleType(TypeDecorator):
    """Store UserRole as VARCHAR(32) but hydrate back into `UserRole` on load.

    Written as a TypeDecorator instead of `sa.Enum` because the installed
    SQLAlchemy version has a bug in Enum init with `values_callable`. This
    approach is dialect-agnostic and works identically on Postgres + SQLite.
    """

    impl = String(32)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, UserRole):
            return value.value
        return UserRole(value).value  # tolerate plain strings for convenience

    def process_result_value(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        return UserRole(value)


class User(UUIDPKMixin, TimestampMixin, Base):
    """A person who can log in. Belongs to at most one Store (nullable for admins)."""

    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("email", name="uq_users_email"),)

    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    # Short human-friendly ID (STF-0001…) the cashier types at the register to
    # attribute a bill to this staff member. Auto-generated on create when
    # missing; unique when present.
    staff_code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True, unique=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Optional default commission percentage — used by the commission engine
    # only when no explicit CommissionRule matches the sale (fallback).
    commission_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)

    # -- Two-factor authentication (TOTP) -------------------------------
    # Base32-encoded shared secret. Only set when the user has enrolled.
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # True after enrollment is confirmed by a valid code; False while pending.
    totp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Stored as VARCHAR(32) (native_enum=False keeps SQLite + Postgres identical),
    # but SQLAlchemy coerces the value back to `UserRole` on load so `.priority()`
    # and `.value` work everywhere.
    role: Mapped[UserRole] = mapped_column(
        _UserRoleType(), nullable=False, index=True
    )
    is_active: Mapped[bool] = mapped_column(nullable=False, default=True)

    store_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stores.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    store: Mapped["Store | None"] = relationship("Store", back_populates="users")

    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        "RefreshToken",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    last_login_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)


class RefreshToken(UUIDPKMixin, TimestampMixin, Base):
    """Server-side record of an issued refresh token.

    We store the SHA-256 hash of the token, never the plaintext. `revoked_at`
    supports both explicit logout and refresh rotation (a used token is revoked
    the moment a new one is issued to replace it).
    """

    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime(), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)
    # If this token was rotated, points at the token that superseded it — a
    # tiny audit chain that makes replay detection trivial.
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("refresh_tokens.id", ondelete="SET NULL"),
        nullable=True,
    )

    user: Mapped["User"] = relationship("User", back_populates="refresh_tokens")
