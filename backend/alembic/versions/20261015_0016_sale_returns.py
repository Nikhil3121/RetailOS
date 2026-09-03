"""Sale returns and credit notes.

Additive only. Every existing row keeps its values and no financial figure is
rewritten: `doc_type` back-fills to 'sale', which is what every row already is.

DESIGN — RETURNS ARE STORED WITH NEGATIVE AMOUNTS.

A return is a row in `sales` with doc_type='return', negative money columns, and
`original_sale_id` pointing at the invoice it reverses.

The alternative was positive amounts plus a type discriminator, which reads more
like the GST credit note it represents. It was rejected because nine service
modules aggregate sale money across roughly forty query sites — dashboard,
reports, day sessions, commissions, campaigns, staff performance. With positive
storage every one of those had to learn to exclude returns, and any site missed
would inflate revenue silently and permanently.

With negative storage those same queries are correct with no change at all:
SUM(grand_total) is net of returns, and a cash refund subtracts itself from the
shift's expected cash. The failure mode inverts from "wrong number nobody sees"
to "a screen shows -₹630", which is visible and cheap to fix.

Presentation is free to show the absolute value with a "Credit note" label; the
sign is a storage decision, not a display one.

CREDIT NOTES GET THEIR OWN NUMBER SERIES. GST requires credit notes to be
serially numbered separately from tax invoices, so `sale_number_sequences` gains
`doc_type` and its uniqueness moves to (store, month, doc_type).

Revision ID: 20261015_0016
Revises: 20261001_0015
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261015_0016"
down_revision: Union[str, None] = "20261001_0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- sales: what kind of document this is ------------------------------
    # server_default so the column can be NOT NULL without a separate backfill
    # pass; every existing row is a sale by definition.
    op.add_column(
        "sales",
        sa.Column(
            "doc_type",
            sa.String(16),
            nullable=False,
            server_default="sale",
        ),
    )
    op.create_index("ix_sales_doc_type", "sales", ["doc_type"])

    # The invoice this return reverses. RESTRICT, not CASCADE: deleting an
    # invoice that has been credited would orphan the credit note and leave the
    # stock movement unexplained.
    op.add_column(
        "sales",
        sa.Column("original_sale_id", sa.Uuid(), nullable=True),
    )
    # batch_alter_table so this migration also runs on SQLite, which cannot
    # ALTER a constraint and needs alembic's copy-and-move strategy. On
    # PostgreSQL — production — it emits a plain ALTER.
    with op.batch_alter_table("sales") as batch:
        batch.create_foreign_key(
            "fk_sales_original_sale",
            "sales",
            ["original_sale_id"],
            ["id"],
            ondelete="RESTRICT",
        )
    op.create_index("ix_sales_original_sale_id", "sales", ["original_sale_id"])

    # ---- credit notes get their own serial series --------------------------
    op.add_column(
        "sale_number_sequences",
        sa.Column("doc_type", sa.String(16), nullable=False, server_default="sale"),
    )
    with op.batch_alter_table("sale_number_sequences") as batch:
        batch.drop_constraint(
            "uq_sale_number_sequences_store_month", type_="unique"
        )
        batch.create_unique_constraint(
            "uq_sale_number_sequences_store_month_type",
            ["store_id", "year_month", "doc_type"],
        )


def downgrade() -> None:
    with op.batch_alter_table("sale_number_sequences") as batch:
        batch.drop_constraint(
            "uq_sale_number_sequences_store_month_type", type_="unique"
        )
        batch.create_unique_constraint(
            "uq_sale_number_sequences_store_month", ["store_id", "year_month"]
        )
    op.drop_column("sale_number_sequences", "doc_type")

    op.drop_index("ix_sales_original_sale_id", table_name="sales")
    with op.batch_alter_table("sales") as batch:
        batch.drop_constraint("fk_sales_original_sale", type_="foreignkey")
    op.drop_column("sales", "original_sale_id")
    op.drop_index("ix_sales_doc_type", table_name="sales")
    op.drop_column("sales", "doc_type")
