"""expense_categories + expenses

Revision ID: 20260515_0008
Revises: 20260501_0007
Create Date: 2026-05-15
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "20260515_0008"
down_revision: Union[str, None] = "20260501_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- expense_categories ------------------------------------------------
    op.create_table(
        "expense_categories",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_expense_categories"),
        sa.UniqueConstraint("code", name="uq_expense_categories_code"),
    )
    op.create_index("ix_expense_categories_code", "expense_categories", ["code"], unique=False)

    # -- expenses ----------------------------------------------------------
    op.create_table(
        "expenses",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("number", sa.String(length=32), nullable=False),
        sa.Column("category_id", UUID(as_uuid=True), nullable=False),
        sa.Column("store_id", UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
        sa.Column("expense_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("tax_amount", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0.00"),
        sa.Column("payment_method", sa.String(length=32), nullable=False, server_default="cash"),
        sa.Column("vendor", sa.String(length=255), nullable=True),
        sa.Column("reference", sa.String(length=128), nullable=True),
        sa.Column("receipt_url", sa.String(length=1024), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("submitted_by_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reject_reason", sa.String(length=255), nullable=True),
        sa.Column("created_by_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_expenses"),
        sa.UniqueConstraint("number", name="uq_expenses_number"),
        sa.ForeignKeyConstraint(
            ["category_id"], ["expense_categories.id"],
            name="fk_expenses_category_id_expense_categories",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["store_id"], ["stores.id"],
            name="fk_expenses_store_id_stores",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["submitted_by_user_id"], ["users.id"],
            name="fk_expenses_submitted_by_user_id_users",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["approved_by_user_id"], ["users.id"],
            name="fk_expenses_approved_by_user_id_users",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["users.id"],
            name="fk_expenses_created_by_user_id_users",
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_expenses_number", "expenses", ["number"], unique=False)
    op.create_index("ix_expenses_category_id", "expenses", ["category_id"], unique=False)
    op.create_index("ix_expenses_store_id", "expenses", ["store_id"], unique=False)
    op.create_index("ix_expenses_status", "expenses", ["status"], unique=False)
    op.create_index("ix_expenses_expense_date", "expenses", ["expense_date"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_expenses_expense_date", table_name="expenses")
    op.drop_index("ix_expenses_status", table_name="expenses")
    op.drop_index("ix_expenses_store_id", table_name="expenses")
    op.drop_index("ix_expenses_category_id", table_name="expenses")
    op.drop_index("ix_expenses_number", table_name="expenses")
    op.drop_table("expenses")

    op.drop_index("ix_expense_categories_code", table_name="expense_categories")
    op.drop_table("expense_categories")
