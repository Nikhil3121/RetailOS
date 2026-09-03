"""Customer credit limits.

One nullable column. NULL means "no limit", which is what every existing
customer implicitly has today, so nothing changes until a limit is set.

The check lives in SaleService, not in a database constraint: the limit is
evaluated against a customer's TOTAL outstanding across bills, which no CHECK
constraint can express, and the answer has to be a readable refusal rather than
an integrity error.

Revision ID: 20261115_0018
Revises: 20261101_0017
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261115_0018"
down_revision: Union[str, None] = "20261101_0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "customers",
        sa.Column("credit_limit", sa.Numeric(14, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("customers", "credit_limit")
