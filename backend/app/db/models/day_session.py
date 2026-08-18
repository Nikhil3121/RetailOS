"""Day session — the cash register's shift.

Exactly one OPEN session may exist per store at any moment. Every sale must
attach to an OPEN session, so closing a session finalises the cash count for
that shift and blocks further sales until the next open.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, TypeDecorator, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin, UtcDateTime


class DayStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"


class _DayStatusType(TypeDecorator):
    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, DayStatus):
            return value.value
        return DayStatus(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        return DayStatus(value)


class DaySession(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "day_sessions"

    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stores.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    status: Mapped[DayStatus] = mapped_column(
        _DayStatusType(), nullable=False, default=DayStatus.OPEN, index=True
    )

    opened_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    opened_at: Mapped[datetime] = mapped_column(UtcDateTime(), nullable=False)
    opening_cash: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )

    closed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)

    # Filled in on close.
    counted_cash: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    expected_cash: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    cash_diff: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
