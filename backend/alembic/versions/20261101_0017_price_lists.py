"""Price lists — wholesale, retail, dealer rates.

Additive only. No existing row changes and no price moves: a variant's
`selling_price` remains the answer for every customer until someone creates a
list and puts a rate on it.

WHY A LIST CAN BE SPARSE. `price_list_items` holds only the overrides. A brand
new "Wholesale" list is immediately usable with two items on it; everything else
falls through to `selling_price`. Requiring a rate for all 9,000 variants before
the list could be used would mean it never got used.

`is_default` is NOT enforced by a partial unique index. Postgres supports one,
SQLite (where the tests run) does not, and a rule enforced in one environment but
not the other is worse than a rule enforced in the service for both.

Revision ID: 20261101_0017
Revises: 20261015_0016
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261101_0017"
down_revision: Union[str, None] = "20261015_0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "price_lists",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.String(512), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_price_lists_code"),
    )
    op.create_index("ix_price_lists_code", "price_lists", ["code"])

    op.create_table(
        "price_list_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("price_list_id", sa.Uuid(), nullable=False),
        sa.Column("variant_id", sa.Uuid(), nullable=False),
        # Same precision as product_variants.selling_price — the two are
        # substituted for one another at billing time.
        sa.Column("price", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["price_list_id"], ["price_lists.id"], ondelete="CASCADE"
        ),
        # RESTRICT: deleting a variant that is priced on a list should fail
        # loudly, not silently revert those customers to the retail rate.
        sa.ForeignKeyConstraint(
            ["variant_id"], ["product_variants.id"], ondelete="RESTRICT"
        ),
        sa.UniqueConstraint(
            "price_list_id", "variant_id", name="uq_price_list_items_list_variant"
        ),
    )
    op.create_index(
        "ix_price_list_items_price_list_id", "price_list_items", ["price_list_id"]
    )
    op.create_index("ix_price_list_items_variant_id", "price_list_items", ["variant_id"])

    # ---- which rate card a customer buys on ---------------------------------
    # Nullable: every existing customer keeps buying at selling_price.
    op.add_column("customers", sa.Column("price_list_id", sa.Uuid(), nullable=True))
    with op.batch_alter_table("customers") as batch:
        batch.create_foreign_key(
            "fk_customers_price_list",
            "price_lists",
            ["price_list_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_customers_price_list_id", "customers", ["price_list_id"])


def downgrade() -> None:
    op.drop_index("ix_customers_price_list_id", table_name="customers")
    with op.batch_alter_table("customers") as batch:
        batch.drop_constraint("fk_customers_price_list", type_="foreignkey")
    op.drop_column("customers", "price_list_id")

    op.drop_index("ix_price_list_items_variant_id", table_name="price_list_items")
    op.drop_index("ix_price_list_items_price_list_id", table_name="price_list_items")
    op.drop_table("price_list_items")
    op.drop_index("ix_price_lists_code", table_name="price_lists")
    op.drop_table("price_lists")
