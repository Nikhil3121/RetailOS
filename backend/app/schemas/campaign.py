"""Campaign DTOs — bulk SMS / WhatsApp / Email broadcasts."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.db.models.campaign import CampaignChannel, CampaignStatus, RecipientStatus
from app.schemas.common import ORMModel


SegmentName = Literal[
    "all",
    "active_30d",
    "active_90d",
    "birthday_month",
    "anniversary_month",
    "never_bought",
    "spent_min",
]


class CampaignSegment(BaseModel):
    """Filter that fans out to CampaignRecipient rows on create.

    Keep this deliberately narrow — a handful of high-value presets that map
    to a single SQL query each. `spent_min` is the one parameterised segment.
    """

    segment: SegmentName = "all"
    spent_min: Decimal | None = Field(
        default=None, ge=0, decimal_places=2, max_digits=14
    )


class CampaignCreate(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    channel: CampaignChannel
    message_body: str = Field(min_length=1, max_length=2000)
    segment: CampaignSegment = Field(default_factory=CampaignSegment)
    # Send now (default) or hold as a draft the user can review + fire later.
    send_now: bool = True


class CampaignRecipientRead(ORMModel):
    id: uuid.UUID
    campaign_id: uuid.UUID
    customer_id: uuid.UUID | None
    phone: str | None
    email: str | None
    status: RecipientStatus
    sent_at: datetime | None
    error: str | None
    created_at: datetime


class CampaignRead(ORMModel):
    id: uuid.UUID
    title: str
    channel: CampaignChannel
    message_body: str
    segment_json: dict[str, Any]
    status: CampaignStatus
    scheduled_at: datetime | None
    sent_at: datetime | None
    total_recipients: int
    sent_count: int
    failed_count: int
    created_by_user_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class CampaignSummary(ORMModel):
    id: uuid.UUID
    title: str
    channel: CampaignChannel
    status: CampaignStatus
    total_recipients: int
    sent_count: int
    failed_count: int
    sent_at: datetime | None
    created_at: datetime


class SegmentPreview(BaseModel):
    """Cheap read used by the compose UI to show 'X customers will get this'."""

    segment: SegmentName
    spent_min: Decimal | None = None
    recipient_count: int
