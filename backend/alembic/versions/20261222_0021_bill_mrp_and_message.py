"""MRP on the bill, and a custom message printed under it.

TWO ADDITIONS, both nullable, no existing value rewritten.

sale_lines.mrp — the printed MRP AT THE TIME OF SALE.

The thermal receipt already prints MRP because the offline SQLite record keeps
it, but a server-issued A4 invoice had no MRP at all. It could not simply read
the variant's current MRP: that is today's figure, and printing it on a bill
from three months ago would show a customer a saving they never received. So it
is snapshotted onto the line like every other money figure, for the same reason.

NULL on every historical line, which is honest — those bills genuinely have no
recorded MRP, and the invoice omits the column rather than inventing one.

stores.receipt_message — free text under the totals: "Happy Holi", "M.S. Mall
wishes you well". Per store, because the two branches are separate businesses
under separate GSTINs and may want to say different things.

Revision ID: 20261222_0021
Revises: 20261215_0020
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261222_0021"
down_revision: Union[str, None] = "20261215_0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Same precision as product_variants.mrp — the two hold the same figure.
    op.add_column("sale_lines", sa.Column("mrp", sa.Numeric(12, 2), nullable=True))
    op.add_column(
        "stores", sa.Column("receipt_message", sa.String(280), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("stores", "receipt_message")
    op.drop_column("sale_lines", "mrp")
