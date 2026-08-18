"""Declarative base + shared mixins for every ORM model.

`Base.metadata` is the single source of truth Alembic uses for autogenerate. A shared
`TimestampMixin` guarantees every table records creation/update timestamps in UTC —
a non-negotiable in retail systems where audit trails are legally required.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, MetaData, TypeDecorator, Uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class UtcDateTime(TypeDecorator):
    """`DateTime(timezone=True)` that always returns UTC-aware datetimes on load.

    Postgres round-trips tz-aware datetimes correctly, but SQLite stores them
    as naive TEXT — comparing naive-from-DB to aware `datetime.now(timezone.utc)`
    raises TypeError. This wrapper attaches UTC to any naive datetime SQLAlchemy
    hands back.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if value.tzinfo is None:
            # Treat naive inputs as UTC so writes remain deterministic.
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def process_result_value(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

# Consistent constraint naming makes Alembic-generated migrations deterministic
# across developer machines and lets us drop/rename constraints unambiguously later.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Root declarative class. Every ORM model must subclass this."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    """Adds `created_at` / `updated_at` columns, populated in Python for portability."""

    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime(),
        default=_utcnow,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        UtcDateTime(),
        default=_utcnow,
        onupdate=_utcnow,
        nullable=False,
    )


class UUIDPKMixin:
    """Adds a UUIDv4 primary key. `sa.Uuid` maps to native UUID on Postgres and
    CHAR(32) on SQLite, so the same models power both prod and tests unchanged."""

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
