"""Product bundles — a saree-plus-blouse combo sold as one line.

One new table. A bundle is an ordinary variant (it has a SKU, a barcode and a
price like anything else) that additionally OWNS a list of component variants.

STOCK IS DECREMENTED FOR THE COMPONENTS, NEVER FOR THE BUNDLE. The combo is a
way of selling, not a thing on a shelf: there is no box of "saree + blouse" in
the stockroom, there is a saree and a blouse. Tracking stock on the bundle
itself would mean the same physical garment counted twice.

The bundle's own price is whatever the shop charges for the combo, which is
usually less than its parts. That is a pricing decision, not arithmetic, so it
is stored on the bundle variant rather than derived.

Revision ID: 20261215_0020
Revises: 20261201_0019
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261215_0020"
down_revision: Union[str, None] = "20261201_0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_bundle_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        # The variant being SOLD — the combo itself.
        sa.Column("bundle_variant_id", sa.Uuid(), nullable=False),
        # One thing that comes out of stock when the combo is sold.
        sa.Column("component_variant_id", sa.Uuid(), nullable=False),
        # How many of the component per one bundle. Numeric, not Integer: a
        # combo can legitimately include 2.5 metres of fabric.
        sa.Column("quantity", sa.Numeric(14, 3), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        # Deleting the bundle removes its recipe; that is the whole point.
        sa.ForeignKeyConstraint(
            ["bundle_variant_id"], ["product_variants.id"], ondelete="CASCADE"
        ),
        # But a component is a real product in its own right — deleting one
        # that a combo depends on must fail loudly, not silently gut the recipe.
        sa.ForeignKeyConstraint(
            ["component_variant_id"], ["product_variants.id"], ondelete="RESTRICT"
        ),
        sa.UniqueConstraint(
            "bundle_variant_id",
            "component_variant_id",
            name="uq_bundle_items_bundle_component",
        ),
    )
    op.create_index(
        "ix_product_bundle_items_bundle", "product_bundle_items", ["bundle_variant_id"]
    )
    op.create_index(
        "ix_product_bundle_items_component",
        "product_bundle_items",
        ["component_variant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_product_bundle_items_component", table_name="product_bundle_items")
    op.drop_index("ix_product_bundle_items_bundle", table_name="product_bundle_items")
    op.drop_table("product_bundle_items")
