"""operations schema — suppliers, customers, inventory, purchase orders

Revision ID: 20260301_0003
Revises: 20260215_0002
Create Date: 2026-03-01
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "20260301_0003"
down_revision: Union[str, None] = "20260215_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- suppliers -------------------------------------------------------
    op.create_table(
        "suppliers",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("contact_person", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("gstin", sa.String(length=15), nullable=True),
        sa.Column("address_line1", sa.String(length=255), nullable=True),
        sa.Column("address_line2", sa.String(length=255), nullable=True),
        sa.Column("city", sa.String(length=128), nullable=True),
        sa.Column("state", sa.String(length=128), nullable=True),
        sa.Column("postal_code", sa.String(length=16), nullable=True),
        sa.Column("country", sa.String(length=2), nullable=False, server_default="IN"),
        sa.Column("notes", sa.String(length=1024), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_suppliers"),
        sa.UniqueConstraint("code", name="uq_suppliers_code"),
    )
    op.create_index("ix_suppliers_code", "suppliers", ["code"], unique=False)

    # -- customers -------------------------------------------------------
    op.create_table(
        "customers",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("gstin", sa.String(length=15), nullable=True),
        sa.Column("company_name", sa.String(length=255), nullable=True),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
        sa.Column("anniversary", sa.Date(), nullable=True),
        sa.Column("address_line1", sa.String(length=255), nullable=True),
        sa.Column("address_line2", sa.String(length=255), nullable=True),
        sa.Column("city", sa.String(length=128), nullable=True),
        sa.Column("state", sa.String(length=128), nullable=True),
        sa.Column("postal_code", sa.String(length=16), nullable=True),
        sa.Column("country", sa.String(length=2), nullable=False, server_default="IN"),
        sa.Column("notes", sa.String(length=1024), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_customers"),
        sa.UniqueConstraint("phone", name="uq_customers_phone"),
    )
    op.create_index("ix_customers_phone", "customers", ["phone"], unique=False)
    op.create_index("ix_customers_email", "customers", ["email"], unique=False)

    # -- stock_movements -------------------------------------------------
    op.create_table(
        "stock_movements",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("variant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("store_id", UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("delta", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("balance_after", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("unit_cost", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("reference_type", sa.String(length=32), nullable=True),
        sa.Column("reference_id", UUID(as_uuid=True), nullable=True),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("created_by_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_stock_movements"),
        sa.ForeignKeyConstraint(
            ["variant_id"], ["product_variants.id"],
            name="fk_stock_movements_variant_id_product_variants",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["store_id"], ["stores.id"],
            name="fk_stock_movements_store_id_stores",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["users.id"],
            name="fk_stock_movements_created_by_user_id_users",
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_stock_movements_variant_id", "stock_movements", ["variant_id"], unique=False)
    op.create_index("ix_stock_movements_store_id", "stock_movements", ["store_id"], unique=False)
    op.create_index("ix_stock_movements_kind", "stock_movements", ["kind"], unique=False)

    # -- stock_balances --------------------------------------------------
    op.create_table(
        "stock_balances",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("variant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("store_id", UUID(as_uuid=True), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=14, scale=3), nullable=False, server_default="0.000"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_stock_balances"),
        sa.UniqueConstraint("variant_id", "store_id", name="uq_stock_balances_variant_store"),
        sa.ForeignKeyConstraint(
            ["variant_id"], ["product_variants.id"],
            name="fk_stock_balances_variant_id_product_variants",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["store_id"], ["stores.id"],
            name="fk_stock_balances_store_id_stores",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_stock_balances_variant_id", "stock_balances", ["variant_id"], unique=False)
    op.create_index("ix_stock_balances_store_id", "stock_balances", ["store_id"], unique=False)

    # -- purchase_orders -------------------------------------------------
    op.create_table(
        "purchase_orders",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("number", sa.String(length=32), nullable=False),
        sa.Column("supplier_id", UUID(as_uuid=True), nullable=False),
        sa.Column("store_id", UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
        sa.Column("order_date", sa.Date(), nullable=False),
        sa.Column("expected_date", sa.Date(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("subtotal", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("tax_total", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("grand_total", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_purchase_orders"),
        sa.UniqueConstraint("number", name="uq_purchase_orders_number"),
        sa.ForeignKeyConstraint(
            ["supplier_id"], ["suppliers.id"],
            name="fk_purchase_orders_supplier_id_suppliers",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["store_id"], ["stores.id"],
            name="fk_purchase_orders_store_id_stores",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["users.id"],
            name="fk_purchase_orders_created_by_user_id_users",
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_purchase_orders_number", "purchase_orders", ["number"], unique=False)
    op.create_index("ix_purchase_orders_supplier_id", "purchase_orders", ["supplier_id"], unique=False)
    op.create_index("ix_purchase_orders_store_id", "purchase_orders", ["store_id"], unique=False)
    op.create_index("ix_purchase_orders_status", "purchase_orders", ["status"], unique=False)

    # -- purchase_order_lines --------------------------------------------
    op.create_table(
        "purchase_order_lines",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("purchase_order_id", UUID(as_uuid=True), nullable=False),
        sa.Column("variant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("unit_cost", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("tax_rate", sa.Numeric(precision=5, scale=2), nullable=False, server_default="0.00"),
        sa.Column("subtotal", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("tax_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("line_total", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_purchase_order_lines"),
        sa.ForeignKeyConstraint(
            ["purchase_order_id"], ["purchase_orders.id"],
            name="fk_purchase_order_lines_purchase_order_id_purchase_orders",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["variant_id"], ["product_variants.id"],
            name="fk_purchase_order_lines_variant_id_product_variants",
            ondelete="RESTRICT",
        ),
    )
    op.create_index(
        "ix_purchase_order_lines_purchase_order_id",
        "purchase_order_lines", ["purchase_order_id"], unique=False,
    )
    op.create_index(
        "ix_purchase_order_lines_variant_id",
        "purchase_order_lines", ["variant_id"], unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_purchase_order_lines_variant_id", table_name="purchase_order_lines")
    op.drop_index("ix_purchase_order_lines_purchase_order_id", table_name="purchase_order_lines")
    op.drop_table("purchase_order_lines")

    op.drop_index("ix_purchase_orders_status", table_name="purchase_orders")
    op.drop_index("ix_purchase_orders_store_id", table_name="purchase_orders")
    op.drop_index("ix_purchase_orders_supplier_id", table_name="purchase_orders")
    op.drop_index("ix_purchase_orders_number", table_name="purchase_orders")
    op.drop_table("purchase_orders")

    op.drop_index("ix_stock_balances_store_id", table_name="stock_balances")
    op.drop_index("ix_stock_balances_variant_id", table_name="stock_balances")
    op.drop_table("stock_balances")

    op.drop_index("ix_stock_movements_kind", table_name="stock_movements")
    op.drop_index("ix_stock_movements_store_id", table_name="stock_movements")
    op.drop_index("ix_stock_movements_variant_id", table_name="stock_movements")
    op.drop_table("stock_movements")

    op.drop_index("ix_customers_email", table_name="customers")
    op.drop_index("ix_customers_phone", table_name="customers")
    op.drop_table("customers")

    op.drop_index("ix_suppliers_code", table_name="suppliers")
    op.drop_table("suppliers")
