"""notifications + notification_rules

Revision ID: 20260601_0009
Revises: 20260515_0008
Create Date: 2026-06-01
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "20260601_0009"
down_revision: Union[str, None] = "20260515_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False, server_default="info"),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("recipient_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("channels", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_notifications"),
        sa.ForeignKeyConstraint(
            ["recipient_user_id"], ["users.id"],
            name="fk_notifications_recipient_user_id_users",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_notifications_kind", "notifications", ["kind"], unique=False)
    op.create_index("ix_notifications_severity", "notifications", ["severity"], unique=False)
    op.create_index(
        "ix_notifications_recipient_user_id",
        "notifications", ["recipient_user_id"], unique=False,
    )

    op.create_table(
        "notification_rules",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("channels", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("target_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("target_role", sa.String(length=32), nullable=True),
        sa.Column("min_severity", sa.String(length=16), nullable=False, server_default="info"),
        sa.Column("config", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_notification_rules"),
        sa.ForeignKeyConstraint(
            ["target_user_id"], ["users.id"],
            name="fk_notification_rules_target_user_id_users",
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_notification_rules_kind", "notification_rules", ["kind"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_notification_rules_kind", table_name="notification_rules")
    op.drop_table("notification_rules")

    op.drop_index("ix_notifications_recipient_user_id", table_name="notifications")
    op.drop_index("ix_notifications_severity", table_name="notifications")
    op.drop_index("ix_notifications_kind", table_name="notifications")
    op.drop_table("notifications")
