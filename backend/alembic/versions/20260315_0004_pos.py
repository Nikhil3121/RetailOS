"""pos schema — day_sessions, sales, sale_lines, sale_payments, invoice sequence

Revision ID: 20260315_0004
Revises: 20260301_0003
Create Date: 2026-03-15
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "20260315_0004"
down_revision: Union[str, None] = "20260301_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- day_sessions -----------------------------------------------------
    op.create_table(
        "day_sessions",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("store_id", UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("opened_by_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("opening_cash", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("closed_by_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("counted_cash", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("expected_cash", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("cash_diff", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_day_sessions"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], name="fk_day_sessions_store_id_stores", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["opened_by_user_id"], ["users.id"], name="fk_day_sessions_opened_by_user_id_users", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["closed_by_user_id"], ["users.id"], name="fk_day_sessions_closed_by_user_id_users", ondelete="SET NULL"),
    )
    op.create_index("ix_day_sessions_store_id", "day_sessions", ["store_id"], unique=False)
    op.create_index("ix_day_sessions_status", "day_sessions", ["status"], unique=False)

    # -- sale_number_sequences -------------------------------------------
    op.create_table(
        "sale_number_sequences",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("store_id", UUID(as_uuid=True), nullable=False),
        sa.Column("year_month", sa.String(length=6), nullable=False),
        sa.Column("next_seq", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_sale_number_sequences"),
        sa.UniqueConstraint("store_id", "year_month", name="uq_sale_number_sequences_store_month"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], name="fk_sale_number_sequences_store_id_stores", ondelete="CASCADE"),
    )
    op.create_index("ix_sale_number_sequences_store_id", "sale_number_sequences", ["store_id"], unique=False)
    op.create_index("ix_sale_number_sequences_year_month", "sale_number_sequences", ["year_month"], unique=False)

    # -- sales -----------------------------------------------------------
    op.create_table(
        "sales",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("number", sa.String(length=48), nullable=False),
        sa.Column("store_id", UUID(as_uuid=True), nullable=False),
        sa.Column("day_session_id", UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="completed"),
        sa.Column("subtotal", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("discount_total", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("tax_total", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("grand_total", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("paid_total", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("change_due", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("void_reason", sa.String(length=255), nullable=True),
        sa.Column("created_by_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_sales"),
        sa.UniqueConstraint("number", name="uq_sales_number"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], name="fk_sales_store_id_stores", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["day_session_id"], ["day_sessions.id"], name="fk_sales_day_session_id_day_sessions", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], name="fk_sales_customer_id_customers", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], name="fk_sales_created_by_user_id_users", ondelete="SET NULL"),
    )
    op.create_index("ix_sales_number", "sales", ["number"], unique=False)
    op.create_index("ix_sales_store_id", "sales", ["store_id"], unique=False)
    op.create_index("ix_sales_day_session_id", "sales", ["day_session_id"], unique=False)
    op.create_index("ix_sales_customer_id", "sales", ["customer_id"], unique=False)
    op.create_index("ix_sales_status", "sales", ["status"], unique=False)

    # -- sale_lines ------------------------------------------------------
    op.create_table(
        "sale_lines",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("sale_id", UUID(as_uuid=True), nullable=False),
        sa.Column("variant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column("variant_name", sa.String(length=255), nullable=False),
        sa.Column("sku", sa.String(length=64), nullable=False),
        sa.Column("hsn_code", sa.String(length=16), nullable=True),
        sa.Column("quantity", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("unit_price", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("discount_pct", sa.Numeric(precision=5, scale=2), nullable=False, server_default="0.00"),
        sa.Column("discount_amount", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("tax_rate", sa.Numeric(precision=5, scale=2), nullable=False, server_default="0.00"),
        sa.Column("subtotal", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("tax_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("line_total", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_sale_lines"),
        sa.ForeignKeyConstraint(["sale_id"], ["sales.id"], name="fk_sale_lines_sale_id_sales", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["variant_id"], ["product_variants.id"], name="fk_sale_lines_variant_id_product_variants", ondelete="RESTRICT"),
    )
    op.create_index("ix_sale_lines_sale_id", "sale_lines", ["sale_id"], unique=False)
    op.create_index("ix_sale_lines_variant_id", "sale_lines", ["variant_id"], unique=False)

    # -- sale_payments ---------------------------------------------------
    op.create_table(
        "sale_payments",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("sale_id", UUID(as_uuid=True), nullable=False),
        sa.Column("method", sa.String(length=16), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("reference", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_sale_payments"),
        sa.ForeignKeyConstraint(["sale_id"], ["sales.id"], name="fk_sale_payments_sale_id_sales", ondelete="CASCADE"),
    )
    op.create_index("ix_sale_payments_sale_id", "sale_payments", ["sale_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_sale_payments_sale_id", table_name="sale_payments")
    op.drop_table("sale_payments")

    op.drop_index("ix_sale_lines_variant_id", table_name="sale_lines")
    op.drop_index("ix_sale_lines_sale_id", table_name="sale_lines")
    op.drop_table("sale_lines")

    op.drop_index("ix_sales_status", table_name="sales")
    op.drop_index("ix_sales_customer_id", table_name="sales")
    op.drop_index("ix_sales_day_session_id", table_name="sales")
    op.drop_index("ix_sales_store_id", table_name="sales")
    op.drop_index("ix_sales_number", table_name="sales")
    op.drop_table("sales")

    op.drop_index("ix_sale_number_sequences_year_month", table_name="sale_number_sequences")
    op.drop_index("ix_sale_number_sequences_store_id", table_name="sale_number_sequences")
    op.drop_table("sale_number_sequences")

    op.drop_index("ix_day_sessions_status", table_name="day_sessions")
    op.drop_index("ix_day_sessions_store_id", table_name="day_sessions")
    op.drop_table("day_sessions")
