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

from sqlalchemy import (
    ForeignKey,
    Index,
    JSON,
    Numeric,
    String,
    Text,
    TypeDecorator,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

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
    __table_args__ = (
        # The service checks for an existing open session before inserting, but
        # two concurrent opens can both pass that check. A partial unique index
        # makes the invariant the database's job: at most one OPEN row per
        # store, whatever the application does.
        Index(
            "uq_day_sessions_one_open_per_store",
            "store_id",
            unique=True,
            postgresql_where=text("status = 'open'"),
            sqlite_where=text("status = 'open'"),
        ),
    )

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
    #: The drawer as notes, e.g. {"500": 6, "100": 11}.
    #:
    #: Optional. When it is given the total is DERIVED from it rather than
    #: asserted, so a fat-fingered digit cannot masquerade as a short drawer —
    #: and a discrepancy becomes investigable ("exactly one 500 missing")
    #: instead of merely noticed.
    #:
    #: JSON rather than a column per note: India has redenominated twice in
    #: living memory, and a schema that has to migrate every time the currency
    #: changes will be wrong at exactly the wrong moment.
    cash_denominations: Mapped[dict[str, int] | None] = mapped_column(
        JSONB().with_variant(JSON(), "sqlite"), nullable=True
    )
    expected_cash: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    cash_diff: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ---- restatement (Phase 5E) --------------------------------------------
    # Set when a late-arriving offline sale is attributed to this session AFTER
    # it was closed. expected_cash and cash_diff are then recomputed, so this
    # flags that the shift's figures are no longer the ones produced at close.
    # The previous values, the sale that caused the change and the reason all
    # live in audit_logs - reusing the existing audit trail rather than adding
    # shadow accounting columns here.
    restated_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)
