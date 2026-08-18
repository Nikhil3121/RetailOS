"""commissions + staff targets

Revision ID: 20260401_0005
Revises: 20260315_0004
Create Date: 2026-04-01
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "20260401_0005"
down_revision: Union[str, None] = "20260315_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- commission_rules ---------------------------------------------------
    op.create_table(
        "commission_rules",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.Column("commission_type", sa.String(length=16), nullable=False),
        sa.Column("rate", sa.Numeric(precision=10, scale=4), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("product_id", UUID(as_uuid=True), nullable=True),
        sa.Column("category_id", UUID(as_uuid=True), nullable=True),
        sa.Column("brand_id", UUID(as_uuid=True), nullable=True),
        sa.Column("staff_id", UUID(as_uuid=True), nullable=True),
        sa.Column("effective_from", sa.Date(), nullable=True),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_commission_rules"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], name="fk_commission_rules_product_id_products", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], name="fk_commission_rules_category_id_categories", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["brand_id"], ["brands.id"], name="fk_commission_rules_brand_id_brands", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["staff_id"], ["users.id"], name="fk_commission_rules_staff_id_users", ondelete="CASCADE"),
    )
    op.create_index("ix_commission_rules_scope", "commission_rules", ["scope"], unique=False)
    op.create_index("ix_commission_rules_priority", "commission_rules", ["priority"], unique=False)
    op.create_index("ix_commission_rules_product_id", "commission_rules", ["product_id"], unique=False)
    op.create_index("ix_commission_rules_category_id", "commission_rules", ["category_id"], unique=False)
    op.create_index("ix_commission_rules_brand_id", "commission_rules", ["brand_id"], unique=False)
    op.create_index("ix_commission_rules_staff_id", "commission_rules", ["staff_id"], unique=False)

    # -- staff_targets ------------------------------------------------------
    op.create_table(
        "staff_targets",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("period", sa.String(length=16), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("target_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_staff_targets"),
        sa.UniqueConstraint(
            "user_id", "period", "period_start",
            name="uq_staff_targets_user_period_start",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"],
            name="fk_staff_targets_user_id_users",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_staff_targets_user_id", "staff_targets", ["user_id"], unique=False)
    op.create_index("ix_staff_targets_period", "staff_targets", ["period"], unique=False)
    op.create_index("ix_staff_targets_period_start", "staff_targets", ["period_start"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_staff_targets_period_start", table_name="staff_targets")
    op.drop_index("ix_staff_targets_period", table_name="staff_targets")
    op.drop_index("ix_staff_targets_user_id", table_name="staff_targets")
    op.drop_table("staff_targets")

    op.drop_index("ix_commission_rules_staff_id", table_name="commission_rules")
    op.drop_index("ix_commission_rules_brand_id", table_name="commission_rules")
    op.drop_index("ix_commission_rules_category_id", table_name="commission_rules")
    op.drop_index("ix_commission_rules_product_id", table_name="commission_rules")
    op.drop_index("ix_commission_rules_priority", table_name="commission_rules")
    op.drop_index("ix_commission_rules_scope", table_name="commission_rules")
    op.drop_table("commission_rules")
