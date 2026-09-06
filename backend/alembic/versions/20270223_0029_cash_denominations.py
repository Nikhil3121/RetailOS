"""Record the drawer as notes counted, not just a total typed

WHY
Closing a shift asks the cashier for one number. A single fat-fingered digit in
that number is indistinguishable from a genuinely short drawer, and the shop
finds out the next morning when nobody remembers what was actually in it.

Counting by denomination — six 500s, eleven 100s — is what a person does
anyway when emptying a till. Recording it turns the total into something
derived rather than asserted: the arithmetic cannot be wrong, and a
discrepancy can be investigated ("we are exactly one 500 short") instead of
merely noticed.

WHY JSON AND NOT COLUMNS
India has redenominated twice in living memory: the ₹1000 note is gone, the
₹2000 was withdrawn in 2023, and the ₹200 did not exist before 2017. A column
per note would need a migration each time, and would carry dead columns
forever. The map is `{"500": 6, "100": 11}` — denomination to count — and the
set of keys is free to change with the currency.

OPTIONAL, ALWAYS
A till that closes with a typed total keeps working exactly as before. This
records the breakdown when someone bothers to enter it; it never demands it.

Revision ID: 20270223_0029
Revises: 20270216_0028
Create Date: 2027-02-23
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20270223_0029"
down_revision: Union[str, None] = "20270216_0028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("day_sessions") as batch:
        batch.add_column(
            sa.Column(
                "cash_denominations",
                postgresql.JSONB().with_variant(sa.JSON(), "sqlite"),
                nullable=True,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("day_sessions") as batch:
        batch.drop_column("cash_denominations")
