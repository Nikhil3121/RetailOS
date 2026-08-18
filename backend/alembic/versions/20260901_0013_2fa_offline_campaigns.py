"""2FA on users, client_uuid on sales (offline idempotency), campaigns tables.

Revision ID: 20260901_0013
Revises: 20260801_0012
Create Date: 2026-09-01
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine.reflection import Inspector

revision: str = "20260901_0013"
down_revision: Union[str, None] = "20260801_0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(inspector: Inspector, table: str, column: str) -> bool:
    return any(c["name"] == column for c in inspector.get_columns(table))


def _has_index(inspector: Inspector, table: str, index: str) -> bool:
    return any(i["name"] == index for i in inspector.get_indexes(table))


def _has_table(inspector: Inspector, table: str) -> bool:
    return table in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # -- users: TOTP fields for 2FA --------------------------------------
    with op.batch_alter_table("users") as batch:
        if not _has_column(inspector, "users", "totp_secret"):
            batch.add_column(sa.Column("totp_secret", sa.String(length=64), nullable=True))
        if not _has_column(inspector, "users", "totp_enabled"):
            batch.add_column(
                sa.Column(
                    "totp_enabled",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )

    # -- sales: idempotency key for offline replay -----------------------
    inspector = sa.inspect(bind)
    with op.batch_alter_table("sales") as batch:
        if not _has_column(inspector, "sales", "client_uuid"):
            batch.add_column(sa.Column("client_uuid", sa.String(length=64), nullable=True))
        if not _has_index(sa.inspect(bind), "sales", "uq_sales_client_uuid"):
            batch.create_index(
                "uq_sales_client_uuid", ["client_uuid"], unique=True
            )

    # -- campaigns + campaign_recipients ---------------------------------
    inspector = sa.inspect(bind)
    if not _has_table(inspector, "campaigns"):
        op.create_table(
            "campaigns",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("title", sa.String(length=128), nullable=False),
            sa.Column("channel", sa.String(length=16), nullable=False),
            sa.Column("message_body", sa.Text(), nullable=False),
            sa.Column("segment_json", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
            sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("total_recipients", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("sent_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_campaigns"),
            sa.ForeignKeyConstraint(
                ["created_by_user_id"], ["users.id"],
                name="fk_campaigns_created_by_user_id_users",
                ondelete="SET NULL",
            ),
        )
        op.create_index("ix_campaigns_status", "campaigns", ["status"])
        op.create_index("ix_campaigns_channel", "campaigns", ["channel"])

    inspector = sa.inspect(bind)
    if not _has_table(inspector, "campaign_recipients"):
        op.create_table(
            "campaign_recipients",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("campaign_id", sa.Uuid(), nullable=False),
            sa.Column("customer_id", sa.Uuid(), nullable=True),
            sa.Column("phone", sa.String(length=32), nullable=True),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column(
                "status",
                sa.String(length=16),
                nullable=False,
                server_default="queued",
            ),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("error", sa.String(length=512), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_campaign_recipients"),
            sa.ForeignKeyConstraint(
                ["campaign_id"], ["campaigns.id"],
                name="fk_campaign_recipients_campaign_id_campaigns",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["customer_id"], ["customers.id"],
                name="fk_campaign_recipients_customer_id_customers",
                ondelete="SET NULL",
            ),
        )
        op.create_index(
            "ix_campaign_recipients_campaign_id",
            "campaign_recipients",
            ["campaign_id"],
        )
        op.create_index(
            "ix_campaign_recipients_status",
            "campaign_recipients",
            ["status"],
        )


def downgrade() -> None:
    op.drop_index("ix_campaign_recipients_status", table_name="campaign_recipients")
    op.drop_index("ix_campaign_recipients_campaign_id", table_name="campaign_recipients")
    op.drop_table("campaign_recipients")

    op.drop_index("ix_campaigns_channel", table_name="campaigns")
    op.drop_index("ix_campaigns_status", table_name="campaigns")
    op.drop_table("campaigns")

    with op.batch_alter_table("sales") as batch:
        batch.drop_index("uq_sales_client_uuid")
        batch.drop_column("client_uuid")

    with op.batch_alter_table("users") as batch:
        batch.drop_column("totp_enabled")
        batch.drop_column("totp_secret")
