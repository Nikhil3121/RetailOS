"""Bulk SMS / WhatsApp / Email campaigns.

A Campaign is a broadcast: pick a channel + a segment of customers + a
message body, and the recipient rows fan out for delivery. Delivery status is
tracked per recipient so a partial failure doesn't lose visibility.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any, TYPE_CHECKING

from sqlalchemy import (
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    TypeDecorator,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin, UtcDateTime

if TYPE_CHECKING:
    from app.db.models.customer import Customer
    from app.db.models.user import User


class CampaignChannel(str, Enum):
    SMS = "sms"
    WHATSAPP = "whatsapp"
    EMAIL = "email"


class CampaignStatus(str, Enum):
    DRAFT = "draft"
    SENDING = "sending"
    SENT = "sent"
    FAILED = "failed"


class RecipientStatus(str, Enum):
    QUEUED = "queued"
    SENT = "sent"
    FAILED = "failed"
    SKIPPED = "skipped"


class _CampaignChannelType(TypeDecorator):
    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, CampaignChannel):
            return value.value
        return CampaignChannel(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        return None if value is None else CampaignChannel(value)


class _CampaignStatusType(TypeDecorator):
    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, CampaignStatus):
            return value.value
        return CampaignStatus(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        return None if value is None else CampaignStatus(value)


class _RecipientStatusType(TypeDecorator):
    impl = String(16)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, RecipientStatus):
            return value.value
        return RecipientStatus(value).value

    def process_result_value(self, value, dialect):  # type: ignore[override]
        return None if value is None else RecipientStatus(value)


class Campaign(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "campaigns"

    title: Mapped[str] = mapped_column(String(128), nullable=False)
    channel: Mapped[CampaignChannel] = mapped_column(
        _CampaignChannelType(), nullable=False, index=True
    )
    message_body: Mapped[str] = mapped_column(Text, nullable=False)
    # Segment filter — free-form JSON so the shape can evolve without a
    # schema change. Known keys:
    #   {"segment": "all" | "active_30d" | "birthday_month" | "anniversary_month"
    #                | "never_bought" | "spent_min", "spent_min": "1000.00"}
    segment_json: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict
    )

    status: Mapped[CampaignStatus] = mapped_column(
        _CampaignStatusType(),
        nullable=False,
        default=CampaignStatus.DRAFT,
        index=True,
    )
    scheduled_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)

    total_recipients: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    recipients: Mapped[list["CampaignRecipient"]] = relationship(
        "CampaignRecipient",
        back_populates="campaign",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    created_by: Mapped["User | None"] = relationship("User")


class CampaignRecipient(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "campaign_recipients"

    campaign_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("campaigns.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
    )
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[RecipientStatus] = mapped_column(
        _RecipientStatusType(),
        nullable=False,
        default=RecipientStatus.QUEUED,
        index=True,
    )
    sent_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)
    error: Mapped[str | None] = mapped_column(String(512), nullable=True)

    campaign: Mapped[Campaign] = relationship("Campaign", back_populates="recipients")
    customer: Mapped["Customer | None"] = relationship("Customer")
