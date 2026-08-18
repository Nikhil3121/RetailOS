"""Audit-log + dashboard-layout DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class AuditLogRead(ORMModel):
    id: uuid.UUID
    action: str
    entity_type: str | None
    entity_id: uuid.UUID | None
    actor_user_id: uuid.UUID | None
    actor_email: str | None
    ip_address: str | None
    user_agent: str | None
    summary: str
    changes: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class DashboardLayoutRead(ORMModel):
    layout: dict[str, Any] = Field(default_factory=dict)


class DashboardLayoutSave(BaseModel):
    layout: dict[str, Any] = Field(
        default_factory=dict,
        description="Free-form JSON — the frontend owns the shape.",
    )
