"""CRM & loyalty — programs, tiers, customer balances, ledger, coupons

Revision ID: 20260415_0006
Revises: 20260401_0005
Create Date: 2026-04-15
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "20260415_0006"
down_revision: Union[str, None] = "20260401_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- loyalty_programs --------------------------------------------------
    op.create_table(
        "loyalty_programs",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False, server_default="Rewards"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("points_per_rupee", sa.Numeric(precision=10, scale=4), nullable=False, server_default="1.0000"),
        sa.Column("redemption_rate", sa.Numeric(precision=10, scale=4), nullable=False, server_default="0.2500"),
        sa.Column("expiry_days", sa.Integer(), nullable=True, server_default="365"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_loyalty_programs"),
    )

    # -- membership_tiers --------------------------------------------------
    op.create_table(
        "membership_tiers",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("min_lifetime_spend", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("points_multiplier", sa.Numeric(precision=6, scale=3), nullable=False, server_default="1.000"),
        sa.Column("default_discount_pct", sa.Numeric(precision=5, scale=2), nullable=False, server_default="0.00"),
        sa.Column("color", sa.String(length=32), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_membership_tiers"),
        sa.UniqueConstraint("name", name="uq_membership_tiers_name"),
    )
    op.create_index("ix_membership_tiers_min_lifetime_spend", "membership_tiers", ["min_lifetime_spend"], unique=False)

    # -- customer_loyalty --------------------------------------------------
    op.create_table(
        "customer_loyalty",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", UUID(as_uuid=True), nullable=False),
        sa.Column("membership_tier_id", UUID(as_uuid=True), nullable=True),
        sa.Column("points_balance", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("wallet_balance", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("lifetime_spend", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("lifetime_earned", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("lifetime_redeemed", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_customer_loyalty"),
        sa.UniqueConstraint("customer_id", name="uq_customer_loyalty_customer_id"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], name="fk_customer_loyalty_customer_id_customers", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_tier_id"], ["membership_tiers.id"], name="fk_customer_loyalty_tier_id_membership_tiers", ondelete="SET NULL"),
    )
    op.create_index("ix_customer_loyalty_customer_id", "customer_loyalty", ["customer_id"], unique=False)
    op.create_index("ix_customer_loyalty_membership_tier_id", "customer_loyalty", ["membership_tier_id"], unique=False)

    # -- loyalty_ledger ----------------------------------------------------
    op.create_table(
        "loyalty_ledger",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("points_delta", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("wallet_delta", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("points_balance_after", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("wallet_balance_after", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("sale_id", UUID(as_uuid=True), nullable=True),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("reference", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.Date(), nullable=True),
        sa.Column("created_by_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_loyalty_ledger"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], name="fk_loyalty_ledger_customer_id_customers", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sale_id"], ["sales.id"], name="fk_loyalty_ledger_sale_id_sales", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], name="fk_loyalty_ledger_created_by_user_id_users", ondelete="SET NULL"),
    )
    op.create_index("ix_loyalty_ledger_customer_id", "loyalty_ledger", ["customer_id"], unique=False)
    op.create_index("ix_loyalty_ledger_kind", "loyalty_ledger", ["kind"], unique=False)
    op.create_index("ix_loyalty_ledger_sale_id", "loyalty_ledger", ["sale_id"], unique=False)

    # -- coupons -----------------------------------------------------------
    op.create_table(
        "coupons",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("discount_type", sa.String(length=16), nullable=False),
        sa.Column("discount_value", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("max_discount_amount", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("min_bill_amount", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("max_uses_total", sa.Integer(), nullable=True),
        sa.Column("max_uses_per_customer", sa.Integer(), nullable=True),
        sa.Column("uses_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("customer_id", UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_coupons"),
        sa.UniqueConstraint("code", name="uq_coupons_code"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], name="fk_coupons_customer_id_customers", ondelete="CASCADE"),
    )
    op.create_index("ix_coupons_code", "coupons", ["code"], unique=False)
    op.create_index("ix_coupons_customer_id", "coupons", ["customer_id"], unique=False)

    # -- coupon_redemptions ------------------------------------------------
    op.create_table(
        "coupon_redemptions",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("coupon_id", UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", UUID(as_uuid=True), nullable=True),
        sa.Column("sale_id", UUID(as_uuid=True), nullable=True),
        sa.Column("discount_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_coupon_redemptions"),
        sa.ForeignKeyConstraint(["coupon_id"], ["coupons.id"], name="fk_coupon_redemptions_coupon_id_coupons", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], name="fk_coupon_redemptions_customer_id_customers", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["sale_id"], ["sales.id"], name="fk_coupon_redemptions_sale_id_sales", ondelete="SET NULL"),
    )
    op.create_index("ix_coupon_redemptions_coupon_id", "coupon_redemptions", ["coupon_id"], unique=False)
    op.create_index("ix_coupon_redemptions_customer_id", "coupon_redemptions", ["customer_id"], unique=False)
    op.create_index("ix_coupon_redemptions_sale_id", "coupon_redemptions", ["sale_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_coupon_redemptions_sale_id", table_name="coupon_redemptions")
    op.drop_index("ix_coupon_redemptions_customer_id", table_name="coupon_redemptions")
    op.drop_index("ix_coupon_redemptions_coupon_id", table_name="coupon_redemptions")
    op.drop_table("coupon_redemptions")

    op.drop_index("ix_coupons_customer_id", table_name="coupons")
    op.drop_index("ix_coupons_code", table_name="coupons")
    op.drop_table("coupons")

    op.drop_index("ix_loyalty_ledger_sale_id", table_name="loyalty_ledger")
    op.drop_index("ix_loyalty_ledger_kind", table_name="loyalty_ledger")
    op.drop_index("ix_loyalty_ledger_customer_id", table_name="loyalty_ledger")
    op.drop_table("loyalty_ledger")

    op.drop_index("ix_customer_loyalty_membership_tier_id", table_name="customer_loyalty")
    op.drop_index("ix_customer_loyalty_customer_id", table_name="customer_loyalty")
    op.drop_table("customer_loyalty")

    op.drop_index("ix_membership_tiers_min_lifetime_spend", table_name="membership_tiers")
    op.drop_table("membership_tiers")

    op.drop_table("loyalty_programs")
