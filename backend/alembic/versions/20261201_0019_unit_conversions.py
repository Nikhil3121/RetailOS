"""Unit conversions — buy in cartons, stock in pieces, sell in either.

A wholesaler receives 20 cartons of 12 and sells single pieces. Until now a
product had ONE unit, so every goods receipt meant multiplying by hand and any
slip went straight into stock with nothing to catch it.

THE BASE UNIT IS THE ONLY UNIT STOCK IS EVER HELD IN. Purchase and sale units
are presentation: a quantity entered in cartons is multiplied by the factor and
stored in pieces. Holding stock in two units would mean two answers to "how many
do we have", and reconciling them is not possible.

Both new columns are NULLABLE with a factor defaulting to 1, so every existing
product behaves exactly as before: one unit, factor 1, no conversion.

Revision ID: 20261201_0019
Revises: 20261115_0018
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261201_0019"
down_revision: Union[str, None] = "20261115_0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The unit goods ARRIVE in. NULL means "same as the base unit".
    op.add_column("products", sa.Column("purchase_unit_id", sa.Uuid(), nullable=True))
    # How many base units are in one purchase unit. 1 carton = 12 pieces -> 12.
    # server_default '1' so existing rows convert 1:1 and nothing moves.
    op.add_column(
        "products",
        sa.Column(
            "purchase_conversion",
            sa.Numeric(14, 4),
            nullable=False,
            server_default="1",
        ),
    )
    with op.batch_alter_table("products") as batch:
        batch.create_foreign_key(
            "fk_products_purchase_unit",
            "units",
            ["purchase_unit_id"],
            ["id"],
            ondelete="RESTRICT",
        )


def downgrade() -> None:
    with op.batch_alter_table("products") as batch:
        batch.drop_constraint("fk_products_purchase_unit", type_="foreignkey")
    op.drop_column("products", "purchase_conversion")
    op.drop_column("products", "purchase_unit_id")
