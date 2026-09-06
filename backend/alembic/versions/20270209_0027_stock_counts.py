"""Physical stock audit: count sheets and their variances

WHY THIS IS THE GO-LIVE BLOCKER
The legacy import brought over products and variants but deliberately NOT
stock, because the old system's quantities could not be trusted. Every variant
therefore currently reads zero, and no amount of careful billing will fix that
— the only honest way to establish opening balances is for someone to walk the
floor and count. Without this table there is nowhere to put the result except
a one-shot adjustment with no record of who counted what, when, or what the
books said at the time.

WHAT A COUNT POSTS, AND WHY IT IS THE VARIANCE
A sheet filled in at 6pm and posted at 9pm has three hours of sales inside it.
Posting "set the balance to the counted figure" would silently re-add every
unit sold in those three hours, overstating stock by exactly the evening's
takings with nothing in the ledger to show for it. So each line snapshots
`system_qty` at entry and posts `counted_qty − system_qty` as a delta: the
discrepancy the counter actually found, with any real movement since preserved
on top of it.

`variance` is stored rather than derived for the same reason — it is fixed at
entry, so a balance that moves before posting cannot quietly change what the
sheet is about to do.

WHAT IT DOES NOT DO
A line that is not on the sheet is not posted. A partial count of the saree
section must never zero the shirts: "we did not look" and "there are none" are
different facts, and conflating them writes off the shop's inventory in one
click.

Revision ID: 20270209_0027
Revises: 20270202_0026
Create Date: 2027-02-09
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20270209_0027"
down_revision: Union[str, None] = "20270202_0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "stock_counts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("store_id", sa.Uuid(), nullable=False),
        # Human handle — "COUNT-2026-03-14-SAREES". Unique per store so two
        # branches counting on the same day cannot collide.
        sa.Column("reference", sa.String(length=64), nullable=False),
        sa.Column("scope", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False,
                  server_default="draft"),
        # Blind by default: shown the expected figure, a tired person at the
        # end of a shift writes it down instead of counting, and the sheet
        # comes back with a perfect zero variance that proves nothing.
        sa.Column("is_blind", sa.Boolean(), nullable=False,
                  server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("counted_by_user_id", sa.Uuid(), nullable=True),
        # Separate from counted_by on purpose: a stock write-off is a money
        # decision and should not be self-approved.
        sa.Column("posted_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("posted_at", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_stock_counts"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"],
                                name="fk_stock_counts_store_id", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["counted_by_user_id"], ["users.id"],
                                name="fk_stock_counts_counted_by", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["posted_by_user_id"], ["users.id"],
                                name="fk_stock_counts_posted_by", ondelete="SET NULL"),
        sa.UniqueConstraint("store_id", "reference",
                            name="uq_stock_counts_store_reference"),
    )
    op.create_index("ix_stock_counts_store_id", "stock_counts", ["store_id"])
    op.create_index("ix_stock_counts_status", "stock_counts", ["status"])

    op.create_table(
        "stock_count_lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("count_id", sa.Uuid(), nullable=False),
        sa.Column("variant_id", sa.Uuid(), nullable=False),
        # What the books said WHEN THE LINE WAS ENTERED — never re-read at
        # post time. This snapshot is the whole reason an evening's sales are
        # not silently reversed by a count taken before them.
        sa.Column("system_qty", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("counted_qty", sa.Numeric(precision=14, scale=3), nullable=False),
        # counted − system, fixed at entry. Stored, not derived.
        sa.Column("variance", sa.Numeric(precision=14, scale=3), nullable=False),
        # A variance with a reason is a correction; one without is shrinkage,
        # and a manager has to be able to tell them apart.
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_stock_count_lines"),
        sa.ForeignKeyConstraint(["count_id"], ["stock_counts.id"],
                                name="fk_stock_count_lines_count_id", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["variant_id"], ["product_variants.id"],
                                name="fk_stock_count_lines_variant_id", ondelete="RESTRICT"),
        # Counting the same variant twice on one sheet is a data-entry
        # mistake, and keeping both would post the variance twice.
        sa.UniqueConstraint("count_id", "variant_id",
                            name="uq_stock_count_lines_count_variant"),
    )
    op.create_index("ix_stock_count_lines_count_id", "stock_count_lines", ["count_id"])
    op.create_index("ix_stock_count_lines_variant_id", "stock_count_lines", ["variant_id"])


def downgrade() -> None:
    op.drop_index("ix_stock_count_lines_variant_id", table_name="stock_count_lines")
    op.drop_index("ix_stock_count_lines_count_id", table_name="stock_count_lines")
    op.drop_table("stock_count_lines")
    op.drop_index("ix_stock_counts_status", table_name="stock_counts")
    op.drop_index("ix_stock_counts_store_id", table_name="stock_counts")
    op.drop_table("stock_counts")
