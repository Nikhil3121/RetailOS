"""product_variants: reorder_point, reorder_quantity, overstock_point

Revision ID: 20260501_0007
Revises: 20260415_0006
Create Date: 2026-05-01

Additive schema change for inventory-intelligence thresholds (Phase 2 · M4).
Backfills all existing variants to (reorder_point=0, reorder_quantity=0,
overstock_point=NULL) which disables the corresponding alerts by default.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260501_0007"
down_revision: Union[str, None] = "20260415_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "product_variants",
        sa.Column(
            "reorder_point",
            sa.Numeric(precision=14, scale=3),
            nullable=False,
            server_default="0.000",
        ),
    )
    op.add_column(
        "product_variants",
        sa.Column(
            "reorder_quantity",
            sa.Numeric(precision=14, scale=3),
            nullable=False,
            server_default="0.000",
        ),
    )
    op.add_column(
        "product_variants",
        sa.Column(
            "overstock_point",
            sa.Numeric(precision=14, scale=3),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("product_variants", "overstock_point")
    op.drop_column("product_variants", "reorder_quantity")
    op.drop_column("product_variants", "reorder_point")
