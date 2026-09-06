"""Snapshot what each sold unit cost the shop

WHY A COLUMN AND NOT A JOIN
Item-wise profit is revenue minus the cost that was actually paid for the
goods. Reading `product_variants.cost_price` at report time instead would
re-price every historical bill the moment a supplier changes their rate — run
the same March report in April and a season's margin has quietly moved, with
nothing to show why.

Same reasoning as `sale_lines.mrp`, which is snapshotted for exactly this
reason: anything a report or a customer may read back later has to be frozen
at the moment of the transaction.

NULL ON EVERY EXISTING LINE, DELIBERATELY
There is no honest value to backfill. Today's cost_price is not what those
goods cost when they were sold, and writing it in would produce a margin
figure that looks authoritative and is invented. The profit report counts the
lines it could not cost and says so instead.

Credit notes copy the cost from the line they reverse rather than re-reading
it, so a fully-returned bill nets to exactly zero margin.

Revision ID: 20270216_0028
Revises: 20270209_0027
Create Date: 2027-02-16
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20270216_0028"
down_revision: Union[str, None] = "20270209_0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("sale_lines") as batch:
        batch.add_column(
            sa.Column("unit_cost", sa.Numeric(precision=12, scale=2), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("sale_lines") as batch:
        batch.drop_column("unit_cost")
