"""Bill-value gift schemes — spend ₹1,000, get a bottle

WHAT THIS IS
------------
The mall's own promotion: reach a bill total and the customer walks out with a
free item. Distinct from the two things already in the schema —

    coupons        money OFF a bill (a discount)
    loyalty        points earned and redeemed over time
    reward_schemes a free GIFT at a bill threshold

— and it does not touch either.

THE GIFTS ARE NOT STOCK
-----------------------
Bottles and steel glasses are bought in bulk outside the catalogue and are not
SKUs, so nothing here moves inventory. `gift_label` is free text and the bill
simply says "Free: Water bottle".

TRACKING WITHOUT STOCK
----------------------
The shop still needs to know how many went out. That does NOT require an
inventory link: every bill that earned a gift records which scheme it was and
what the gift was called, so counting them is a GROUP BY. Deriving the count
from the bills rather than keeping a counter on the scheme is deliberate — a
counter drifts the first time a sale is voided, and then nobody trusts it.

`sales.reward_label` is SNAPSHOTTED, like `mrp` and `tax_rate` before it.
Rename the scheme in December and a November bill still reads what the customer
was actually handed.

Revision ID: 20270112_0023
Revises: 20270105_0022
Create Date: 2027-01-12
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20270112_0023"
down_revision: Union[str, None] = "20270105_0022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "reward_schemes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        # The bill total at or above which the gift is earned.
        sa.Column("min_bill_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        # What the customer is handed. Free text — these are not SKUs.
        sa.Column("gift_label", sa.String(length=128), nullable=False),
        # NULL means every branch. The two malls file under separate GSTINs and
        # may well run a festival offer at one and not the other.
        sa.Column("store_id", sa.Uuid(), nullable=True),
        # NULL at either end means open-ended, so a permanent scheme needs no
        # dates and a Diwali one is switched off by the calendar rather than by
        # somebody remembering.
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_reward_schemes"),
        sa.ForeignKeyConstraint(
            ["store_id"], ["stores.id"],
            name="fk_reward_schemes_store_id_stores",
            ondelete="CASCADE",
        ),
    )
    # The billing screen asks "which scheme does this total reach" on every
    # keystroke, so the threshold is indexed.
    op.create_index(
        "ix_reward_schemes_min_bill_amount",
        "reward_schemes",
        ["min_bill_amount"],
        unique=False,
    )
    op.create_index(
        "ix_reward_schemes_store_id", "reward_schemes", ["store_id"], unique=False
    )

    with op.batch_alter_table("sales") as batch:
        batch.add_column(sa.Column("reward_scheme_id", sa.Uuid(), nullable=True))
        # Snapshot. Survives the scheme being renamed, and survives it being
        # deleted — the bill still says what the customer was given.
        batch.add_column(sa.Column("reward_label", sa.String(length=128), nullable=True))
        batch.create_foreign_key(
            "fk_sales_reward_scheme_id_reward_schemes",
            "reward_schemes",
            ["reward_scheme_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.create_index(
        "ix_sales_reward_scheme_id", "sales", ["reward_scheme_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_sales_reward_scheme_id", table_name="sales")
    with op.batch_alter_table("sales") as batch:
        batch.drop_constraint(
            "fk_sales_reward_scheme_id_reward_schemes", type_="foreignkey"
        )
        batch.drop_column("reward_label")
        batch.drop_column("reward_scheme_id")

    op.drop_index("ix_reward_schemes_store_id", table_name="reward_schemes")
    op.drop_index("ix_reward_schemes_min_bill_amount", table_name="reward_schemes")
    op.drop_table("reward_schemes")
