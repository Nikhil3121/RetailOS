"""Supplier ledger, purchase charges, and a rate-change log

THREE GAPS, ALL EVIDENCED BY THE OUTGOING SYSTEM
------------------------------------------------
    SUPLEDGER        1,222 rows   what the shop OWES each supplier
    MELO_CHARGE      1,148 rows   freight and other charges on a purchase
    RATEALTERATION     130 rows   old -> new purchase price and MRP

RetailOS tracked what customers owe it and nothing at all about what it owes
the mills. It also treated the invoice rate as the cost, so freight was never
part of a landed cost and every margin figure was quietly optimistic.

supplier_ledger_entries
    Double-entry in the small: a goods receipt CREDITS the supplier (we owe
    them), a payment DEBITS them. The outstanding balance is the sum, so it
    cannot drift out of step with the documents behind it the way a running
    `balance` column on `suppliers` would.

    `entry_date` is separate from `created_at` because a payment made on
    Saturday and entered on Monday belongs to Saturday.

purchase_order_charges
    Freight, labour, insurance — each with its own GST rate, because they are
    taxed differently from the goods. `is_deduction` covers the legacy "kalti":
    a shortage or damage allowance the mill knocks off the bill.

price_change_log
    Written whenever a variant's cost or selling price moves. The audit log
    records that a product was edited; it cannot answer "what did we reprice
    last month and by how much", which is the question actually asked.

Revision ID: 20270119_0024
Revises: 20270112_0023
Create Date: 2027-01-19
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20270119_0024"
down_revision: Union[str, None] = "20270112_0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- what we owe each supplier ------------------------------------------
    op.create_table(
        "supplier_ledger_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("supplier_id", sa.Uuid(), nullable=False),
        sa.Column("store_id", sa.Uuid(), nullable=True),
        sa.Column("entry_date", sa.Date(), nullable=False),
        # "purchase", "payment", "purchase_return", "adjustment"
        sa.Column("entry_type", sa.String(length=24), nullable=False),
        sa.Column("reference", sa.String(length=64), nullable=True),
        sa.Column("description", sa.String(length=255), nullable=True),
        # Exactly one side carries a value; the other is zero. Two columns
        # rather than one signed amount because that is how a ledger is read,
        # and a sign error in a single column is invisible.
        sa.Column("debit", sa.Numeric(precision=14, scale=2), nullable=False,
                  server_default="0.00"),
        sa.Column("credit", sa.Numeric(precision=14, scale=2), nullable=False,
                  server_default="0.00"),
        sa.Column("purchase_order_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_supplier_ledger_entries"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"],
                                name="fk_sle_supplier_id", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"],
                                name="fk_sle_store_id", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["purchase_order_id"], ["purchase_orders.id"],
                                name="fk_sle_purchase_order_id", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"],
                                name="fk_sle_created_by_user_id", ondelete="SET NULL"),
    )
    op.create_index("ix_sle_supplier_id", "supplier_ledger_entries",
                    ["supplier_id"], unique=False)
    op.create_index("ix_sle_entry_date", "supplier_ledger_entries",
                    ["entry_date"], unique=False)

    # -- freight and other charges on a purchase ----------------------------
    op.create_table(
        "purchase_order_charges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("purchase_order_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("tax_rate", sa.Numeric(precision=5, scale=2), nullable=False,
                  server_default="0.00"),
        # The legacy "kalti": an allowance the mill knocks OFF the bill for a
        # shortage or damage. Stored as a flag rather than a negative amount so
        # a report can say "charges" and "deductions" separately.
        sa.Column("is_deduction", sa.Boolean(), nullable=False,
                  server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_purchase_order_charges"),
        sa.ForeignKeyConstraint(["purchase_order_id"], ["purchase_orders.id"],
                                name="fk_poc_purchase_order_id", ondelete="CASCADE"),
    )
    op.create_index("ix_poc_purchase_order_id", "purchase_order_charges",
                    ["purchase_order_id"], unique=False)

    # -- what we repriced, and when -----------------------------------------
    op.create_table(
        "price_change_log",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("variant_id", sa.Uuid(), nullable=False),
        sa.Column("old_cost_price", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("new_cost_price", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("old_mrp", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("new_mrp", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("old_selling_price", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("new_selling_price", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("changed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_price_change_log"),
        # CASCADE: a price history for a SKU that no longer exists answers no
        # question anyone asks.
        sa.ForeignKeyConstraint(["variant_id"], ["product_variants.id"],
                                name="fk_pcl_variant_id", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["changed_by_user_id"], ["users.id"],
                                name="fk_pcl_changed_by_user_id", ondelete="SET NULL"),
    )
    op.create_index("ix_pcl_variant_id", "price_change_log", ["variant_id"], unique=False)
    op.create_index("ix_pcl_created_at", "price_change_log", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_pcl_created_at", table_name="price_change_log")
    op.drop_index("ix_pcl_variant_id", table_name="price_change_log")
    op.drop_table("price_change_log")

    op.drop_index("ix_poc_purchase_order_id", table_name="purchase_order_charges")
    op.drop_table("purchase_order_charges")

    op.drop_index("ix_sle_entry_date", table_name="supplier_ledger_entries")
    op.drop_index("ix_sle_supplier_id", table_name="supplier_ledger_entries")
    op.drop_table("supplier_ledger_entries")
