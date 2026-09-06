"""Held bills shared across counters, salesperson per line, reprint tracking

HELD BILLS
They lived in `localStorage`, which means they lived in ONE BROWSER. Counter 1
and counter 2 at the same mall could not see each other's parked bills, so a
customer who stepped away at one till could not be finished at the other. With
two counters per mall that is a daily problem, not an edge case.

Held on the server, scoped to a store. The cart is stored as JSON rather than
as real sale lines because a held bill is NOT a sale — it has no invoice
number, no stock movement and no money. Giving it rows in `sales` would put a
non-transaction into every revenue query that has ever been written.

SALESPERSON PER LINE
`sales.salesperson_user_id` credits the WHOLE bill to one person. In a garment
shop two staff routinely split a bill — one sells the saree, another the
blouse — and commission is computed from this. Crediting it all to whoever was
selected last is simply wrong, and quietly so.

Nullable, and the line falls back to the bill's salesperson when unset, so
every existing bill and every simple sale behaves exactly as before.

REPRINT TRACKING
A reprint was indistinguishable from an original. Two identical-looking copies
of one invoice is how a bill gets paid twice, or a return processed against a
copy. The count is stored so the second and later copies can be marked.

Revision ID: 20270202_0026
Revises: 20270126_0025
Create Date: 2027-02-02
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20270202_0026"
down_revision: Union[str, None] = "20270126_0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "held_bills",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("store_id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=True),
        sa.Column("salesperson_user_id", sa.Uuid(), nullable=True),
        sa.Column("label", sa.String(length=128), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        # The cart, verbatim. JSON because a held bill is not a sale: it has no
        # number, no stock movement and no money, and giving it rows in `sales`
        # would put a non-transaction into every revenue query in the system.
        sa.Column(
            "cart",
            postgresql.JSONB().with_variant(sa.JSON(), "sqlite"),
            nullable=False,
        ),
        sa.Column("held_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("terminal_uuid", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_held_bills"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"],
                                name="fk_held_bills_store_id", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"],
                                name="fk_held_bills_customer_id", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["salesperson_user_id"], ["users.id"],
                                name="fk_held_bills_salesperson_id", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["held_by_user_id"], ["users.id"],
                                name="fk_held_bills_held_by_id", ondelete="SET NULL"),
    )
    op.create_index("ix_held_bills_store_id", "held_bills", ["store_id"], unique=False)

    with op.batch_alter_table("sale_lines") as batch:
        batch.add_column(sa.Column("salesperson_user_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            "fk_sale_lines_salesperson_user_id_users",
            "users",
            ["salesperson_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index(
        "ix_sale_lines_salesperson_user_id",
        "sale_lines",
        ["salesperson_user_id"],
        unique=False,
    )

    with op.batch_alter_table("sales") as batch:
        # How many times this bill has been printed. 1 is the original; anything
        # above marks a DUPLICATE on the paper, so two identical copies cannot
        # be paid twice or returned against separately.
        batch.add_column(
            sa.Column("print_count", sa.Integer(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    with op.batch_alter_table("sales") as batch:
        batch.drop_column("print_count")

    op.drop_index("ix_sale_lines_salesperson_user_id", table_name="sale_lines")
    with op.batch_alter_table("sale_lines") as batch:
        batch.drop_constraint("fk_sale_lines_salesperson_user_id_users",
                              type_="foreignkey")
        batch.drop_column("salesperson_user_id")

    op.drop_index("ix_held_bills_store_id", table_name="held_bills")
    op.drop_table("held_bills")
