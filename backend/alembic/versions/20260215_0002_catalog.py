"""catalog schema — units, brands, categories, products, variants, images

Revision ID: 20260215_0002
Revises: 20260201_0001
Create Date: 2026-02-15
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "20260215_0002"
down_revision: Union[str, None] = "20260201_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- units -----------------------------------------------------------
    op.create_table(
        "units",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("symbol", sa.String(length=16), nullable=False),
        sa.Column("is_fractional", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_units"),
        sa.UniqueConstraint("symbol", name="uq_units_symbol"),
    )

    # -- brands ----------------------------------------------------------
    op.create_table(
        "brands",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("slug", sa.String(length=160), nullable=False),
        sa.Column("description", sa.String(length=1024), nullable=True),
        sa.Column("logo_url", sa.String(length=1024), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_brands"),
        sa.UniqueConstraint("slug", name="uq_brands_slug"),
    )
    op.create_index("ix_brands_slug", "brands", ["slug"], unique=False)

    # -- categories ------------------------------------------------------
    op.create_table(
        "categories",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("slug", sa.String(length=160), nullable=False),
        sa.Column("description", sa.String(length=1024), nullable=True),
        sa.Column("parent_id", UUID(as_uuid=True), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_categories"),
        sa.UniqueConstraint("slug", name="uq_categories_slug"),
        sa.ForeignKeyConstraint(
            ["parent_id"], ["categories.id"],
            name="fk_categories_parent_id_categories",
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_categories_slug", "categories", ["slug"], unique=False)
    op.create_index("ix_categories_parent_id", "categories", ["parent_id"], unique=False)

    # -- products --------------------------------------------------------
    op.create_table(
        "products",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("hsn_code", sa.String(length=16), nullable=True),
        sa.Column("tax_rate", sa.Numeric(precision=5, scale=2), nullable=False, server_default="0.00"),
        sa.Column("brand_id", UUID(as_uuid=True), nullable=True),
        sa.Column("category_id", UUID(as_uuid=True), nullable=True),
        sa.Column("unit_id", UUID(as_uuid=True), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_products"),
        sa.ForeignKeyConstraint(
            ["brand_id"], ["brands.id"], name="fk_products_brand_id_brands", ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["category_id"], ["categories.id"], name="fk_products_category_id_categories",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["unit_id"], ["units.id"], name="fk_products_unit_id_units", ondelete="RESTRICT"
        ),
    )
    op.create_index("ix_products_name", "products", ["name"], unique=False)
    op.create_index("ix_products_hsn_code", "products", ["hsn_code"], unique=False)
    op.create_index("ix_products_brand_id", "products", ["brand_id"], unique=False)
    op.create_index("ix_products_category_id", "products", ["category_id"], unique=False)
    op.create_index("ix_products_unit_id", "products", ["unit_id"], unique=False)

    # -- product_variants ------------------------------------------------
    op.create_table(
        "product_variants",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("sku", sa.String(length=64), nullable=False),
        sa.Column("barcode", sa.String(length=64), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("cost_price", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0.00"),
        sa.Column("mrp", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0.00"),
        sa.Column("selling_price", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0.00"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_product_variants"),
        sa.UniqueConstraint("sku", name="uq_product_variants_sku"),
        sa.UniqueConstraint("barcode", name="uq_product_variants_barcode"),
        sa.ForeignKeyConstraint(
            ["product_id"], ["products.id"],
            name="fk_product_variants_product_id_products",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_product_variants_product_id", "product_variants", ["product_id"], unique=False)
    op.create_index("ix_product_variants_sku", "product_variants", ["sku"], unique=False)
    op.create_index("ix_product_variants_barcode", "product_variants", ["barcode"], unique=False)

    # -- product_images --------------------------------------------------
    op.create_table(
        "product_images",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", UUID(as_uuid=True), nullable=False),
        sa.Column("url", sa.String(length=1024), nullable=False),
        sa.Column("alt_text", sa.String(length=255), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_product_images"),
        sa.ForeignKeyConstraint(
            ["product_id"], ["products.id"],
            name="fk_product_images_product_id_products",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_product_images_product_id", "product_images", ["product_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_product_images_product_id", table_name="product_images")
    op.drop_table("product_images")

    op.drop_index("ix_product_variants_barcode", table_name="product_variants")
    op.drop_index("ix_product_variants_sku", table_name="product_variants")
    op.drop_index("ix_product_variants_product_id", table_name="product_variants")
    op.drop_table("product_variants")

    op.drop_index("ix_products_unit_id", table_name="products")
    op.drop_index("ix_products_category_id", table_name="products")
    op.drop_index("ix_products_brand_id", table_name="products")
    op.drop_index("ix_products_hsn_code", table_name="products")
    op.drop_index("ix_products_name", table_name="products")
    op.drop_table("products")

    op.drop_index("ix_categories_parent_id", table_name="categories")
    op.drop_index("ix_categories_slug", table_name="categories")
    op.drop_table("categories")

    op.drop_index("ix_brands_slug", table_name="brands")
    op.drop_table("brands")

    op.drop_table("units")
