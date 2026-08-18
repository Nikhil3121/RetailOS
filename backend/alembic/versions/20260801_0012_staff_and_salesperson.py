"""Add staff_code + phone + commission_pct to users; salesperson_user_id to sales.

Revision ID: 20260801_0012
Revises: 20260701_0011
Create Date: 2026-08-01

Motivation: mall counter workflow needs a *salesperson* on each bill separate
from the cashier who rang it up, so commission and performance credit land on
the staff who actually made the sale. `staff_code` is the human-friendly ID
(STF-0001 …) the cashier types at the register to attribute the bill.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine.reflection import Inspector

revision: str = "20260801_0012"
down_revision: Union[str, None] = "20260701_0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(inspector: Inspector, table: str, column: str) -> bool:
    return any(c["name"] == column for c in inspector.get_columns(table))


def _has_index(inspector: Inspector, table: str, index: str) -> bool:
    return any(i["name"] == index for i in inspector.get_indexes(table))


def upgrade() -> None:
    """Idempotent because the first attempt at this migration partially
    committed on SQLite (non-transactional DDL) before failing on the FK add.
    Re-running must therefore skip anything already in place."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # -- users ------------------------------------------------------------
    with op.batch_alter_table("users") as batch:
        if not _has_column(inspector, "users", "staff_code"):
            batch.add_column(sa.Column("staff_code", sa.String(length=32), nullable=True))
        if not _has_column(inspector, "users", "phone"):
            batch.add_column(sa.Column("phone", sa.String(length=32), nullable=True))
        if not _has_column(inspector, "users", "commission_pct"):
            batch.add_column(
                sa.Column("commission_pct", sa.Numeric(5, 2), nullable=True)
            )
        # Re-inspect: indexes on batch tables reflect the fresh table.
        if not _has_index(sa.inspect(bind), "users", "ix_users_staff_code"):
            batch.create_index("ix_users_staff_code", ["staff_code"], unique=True)

    # -- sales ------------------------------------------------------------
    inspector = sa.inspect(bind)
    with op.batch_alter_table("sales") as batch:
        if not _has_column(inspector, "sales", "salesperson_user_id"):
            batch.add_column(sa.Column("salesperson_user_id", sa.Uuid(), nullable=True))
        # The batch always emits a full CREATE TABLE, so the FK will be baked
        # in regardless — declaring it here makes it explicit in the schema.
        batch.create_foreign_key(
            "fk_sales_salesperson_user_id_users",
            "users",
            ["salesperson_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
        if not _has_index(sa.inspect(bind), "sales", "ix_sales_salesperson_user_id"):
            batch.create_index(
                "ix_sales_salesperson_user_id", ["salesperson_user_id"]
            )


def downgrade() -> None:
    with op.batch_alter_table("sales") as batch:
        batch.drop_index("ix_sales_salesperson_user_id")
        batch.drop_constraint(
            "fk_sales_salesperson_user_id_users", type_="foreignkey"
        )
        batch.drop_column("salesperson_user_id")

    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_staff_code")
        batch.drop_column("commission_pct")
        batch.drop_column("phone")
        batch.drop_column("staff_code")
