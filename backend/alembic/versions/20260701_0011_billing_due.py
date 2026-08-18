"""Add balance_due column to sales for credit / partial-payment bills.

Revision ID: 20260701_0011
Revises: 20260615_0010
Create Date: 2026-07-01
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260701_0011"
down_revision: Union[str, None] = "20260615_0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sales",
        sa.Column(
            "balance_due",
            sa.Numeric(14, 2),
            nullable=False,
            server_default="0.00",
        ),
    )
    op.create_index(
        "ix_sales_balance_due",
        "sales",
        ["balance_due"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_sales_balance_due", table_name="sales")
    op.drop_column("sales", "balance_due")
