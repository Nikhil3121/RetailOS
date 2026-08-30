"""Phase 5E — explicit offline attribution, terminal identity, session restatement.

Additive only. Every column is nullable, every existing row keeps its values,
and no financial figure is rewritten by this migration.

The one non-column change is a PARTIAL UNIQUE INDEX enforcing "at most one OPEN
day session per store". That rule already existed in application code, but two
concurrent opens could both pass the check and create a second open shift. A
data audit run before writing this migration confirmed no store currently has
duplicate open sessions, so the index can be created without repairing
anything. If that is ever untrue on another deployment the CREATE will fail
loudly — which is the correct outcome: accounting history must be reconciled by
a human, not silently merged.

Revision ID: 20261001_0015
Revises: 20260915_0014
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261001_0015"
down_revision: Union[str, None] = "20260915_0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- sales: when it happened, and which till rang it --------------------
    # Nullable: every sale written before this phase legitimately has neither.
    op.add_column(
        "sales",
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("sales", sa.Column("terminal_uuid", sa.String(64), nullable=True))
    # Per-terminal cash reconciliation reads by this column.
    op.create_index("ix_sales_terminal_uuid", "sales", ["terminal_uuid"], unique=False)

    # ---- day_sessions: marker that a closed shift was restated -------------
    op.add_column(
        "day_sessions",
        sa.Column("restated_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ---- one OPEN session per store, enforced by the database --------------
    op.create_index(
        "uq_day_sessions_one_open_per_store",
        "day_sessions",
        ["store_id"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
    )


def downgrade() -> None:
    # Reversible: the columns carry no data any earlier revision depends on.
    # Dropping them discards offline attribution recorded since the upgrade,
    # so this is a rollback path, not a routine operation.
    op.drop_index("uq_day_sessions_one_open_per_store", table_name="day_sessions")
    op.drop_column("day_sessions", "restated_at")
    op.drop_index("ix_sales_terminal_uuid", table_name="sales")
    op.drop_column("sales", "terminal_uuid")
    op.drop_column("sales", "occurred_at")
