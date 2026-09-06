"""Bill-level discount, round-off, and the coupon actually applied

WHY THIS UNBLOCKS THREE THINGS AT ONCE
--------------------------------------
RetailOS could only discount a LINE. That single gap blocked:

  * a plain "₹200 off the bill", which is how a shopkeeper actually negotiates
  * coupons — fully built, with a /validate endpoint, and ZERO references in
    the billing screen, because there was nowhere to put the money off
  * loyalty redemption, which could record points as spent but could not
    reduce the bill they were spent on

The legacy system had BILLDISCSC for exactly this.

ROUND-OFF
GST invoices are conventionally rounded to the rupee, with the adjustment shown
as its own line. RetailOS had none anywhere, so a bill ended in stray paise
that no customer hands over and no drawer can make change for.

Stored rather than recomputed on display: the round-off is part of what the
customer paid, and re-deriving it later from a changed rounding rule would make
an old bill stop adding up.

WHAT IS DELIBERATELY NOT DONE HERE
----------------------------------
The discount is NOT spread across the lines. Allocating it would change each
line's taxable value and therefore its GST, which is a tax decision, not a
display one. It is held at the bill level where it belongs, and the tax already
computed per line is left exactly as it was.

Revision ID: 20270126_0025
Revises: 20270119_0024
Create Date: 2027-01-26
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20270126_0025"
down_revision: Union[str, None] = "20270119_0024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("sales") as batch:
        # Money taken off the WHOLE bill, after the lines are totalled.
        batch.add_column(
            sa.Column(
                "bill_discount",
                sa.Numeric(precision=14, scale=2),
                nullable=False,
                server_default="0.00",
            )
        )
        batch.add_column(
            sa.Column("bill_discount_reason", sa.String(length=255), nullable=True)
        )
        # Signed: -0.40 rounds 240.40 down to 240, +0.60 rounds 239.40 up.
        batch.add_column(
            sa.Column(
                "round_off",
                sa.Numeric(precision=6, scale=2),
                nullable=False,
                server_default="0.00",
            )
        )
        # Which coupon was applied, if any, plus a snapshot of its code — so a
        # coupon later renamed or deleted still reads correctly on an old bill.
        batch.add_column(sa.Column("coupon_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("coupon_code", sa.String(length=32), nullable=True))
        batch.create_foreign_key(
            "fk_sales_coupon_id_coupons",
            "coupons",
            ["coupon_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.create_index("ix_sales_coupon_id", "sales", ["coupon_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_sales_coupon_id", table_name="sales")
    with op.batch_alter_table("sales") as batch:
        batch.drop_constraint("fk_sales_coupon_id_coupons", type_="foreignkey")
        batch.drop_column("coupon_code")
        batch.drop_column("coupon_id")
        batch.drop_column("round_off")
        batch.drop_column("bill_discount_reason")
        batch.drop_column("bill_discount")
