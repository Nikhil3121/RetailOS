"""Response schemas for the health / readiness endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SubsystemStatus(BaseModel):
    ok: bool
    detail: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
    environment: str
    timestamp: datetime


class ReadinessResponse(BaseModel):
    status: Literal["ready", "degraded"]
    subsystems: dict[str, SubsystemStatus] = Field(default_factory=dict)
    timestamp: datetime
