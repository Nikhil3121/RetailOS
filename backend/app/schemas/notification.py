"""Notification DTOs — records + rules + ad-hoc create."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.db.models.notification import (
    NotificationChannel,
    NotificationKind,
    NotificationSeverity,
)
from app.schemas.common import ORMModel


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


class NotificationRead(ORMModel):
    id: uuid.UUID
    kind: NotificationKind
    severity: NotificationSeverity
    title: str
    body: str | None
    recipient_user_id: uuid.UUID | None
    channels: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="metadata_json")
    read_at: datetime | None
    created_at: datetime


class NotificationCreate(BaseModel):
    """Ad-hoc notification — used for custom / manual broadcasts."""

    kind: NotificationKind = NotificationKind.CUSTOM
    severity: NotificationSeverity = NotificationSeverity.INFO
    title: str = Field(min_length=1, max_length=255)
    body: str | None = None
    recipient_user_id: uuid.UUID | None = None
    channels: list[NotificationChannel] = Field(
        default_factory=lambda: [NotificationChannel.IN_APP]
    )
    metadata: dict[str, Any] = Field(default_factory=dict)


class NotificationUnreadCount(BaseModel):
    unread: int


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------


class NotificationRuleBase(BaseModel):
    kind: NotificationKind
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None
    is_active: bool = True
    channels: list[NotificationChannel] = Field(
        default_factory=lambda: [NotificationChannel.IN_APP]
    )
    target_user_id: uuid.UUID | None = None
    target_role: str | None = Field(default=None, max_length=32)
    min_severity: NotificationSeverity = NotificationSeverity.INFO
    config: dict[str, Any] = Field(default_factory=dict)


class NotificationRuleCreate(NotificationRuleBase):
    pass


class NotificationRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    is_active: bool | None = None
    channels: list[NotificationChannel] | None = None
    target_user_id: uuid.UUID | None = None
    target_role: str | None = Field(default=None, max_length=32)
    min_severity: NotificationSeverity | None = None
    config: dict[str, Any] | None = None


class NotificationRuleRead(ORMModel):
    id: uuid.UUID
    kind: NotificationKind
    name: str
    description: str | None
    is_active: bool
    channels: list[str] = Field(default_factory=list)
    target_user_id: uuid.UUID | None
    target_role: str | None
    min_severity: NotificationSeverity
    config: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
