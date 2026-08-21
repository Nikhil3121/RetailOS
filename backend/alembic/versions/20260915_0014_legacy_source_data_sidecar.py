"""Legacy source-data side-car.

Adds a nullable JSONB `source_data` column to the six tables that receive
imported rows from legacy systems (Richie Retail today, possibly others
later). Nothing in the application writes to this column at runtime —
loaders stash the raw source row here so no field is ever lost during
migration, without polluting the first-class schema with vendor-specific
columns that most screens will never surface.

The side-car is intentionally NULL by default so every existing endpoint
keeps behaving identically; only import tooling touches it.

Revision ID: 20260915_0014
Revises: 20260901_0013
Create Date: 2026-09-15
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine.reflection import Inspector


revision: str = "20260915_0014"
down_revision: Union[str, None] = "20260901_0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The tables that can receive legacy imports. Kept as a module-level constant
# so both upgrade() and downgrade() operate on the same list.
TARGET_TABLES: tuple[str, ...] = (
    "brands",
    "categories",
    "products",
    "product_variants",
    "customers",
    "stock_movements",
)


def _has_column(inspector: Inspector, table: str, column: str) -> bool:
    return any(c["name"] == column for c in inspector.get_columns(table))


def _jsonb_column() -> sa.Column:
    """Use JSONB on Postgres, plain JSON on SQLite — both back to `dict` in Python."""
    return sa.Column(
        "source_data",
        postgresql.JSONB(astext_type=sa.Text()).with_variant(sa.JSON(), "sqlite"),
        nullable=True,
    )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table in TARGET_TABLES:
        if not _has_column(inspector, table, "source_data"):
            op.add_column(table, _jsonb_column())


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table in TARGET_TABLES:
        if _has_column(inspector, table, "source_data"):
            op.drop_column(table, "source_data")
