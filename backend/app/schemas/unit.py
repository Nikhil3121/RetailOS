"""Unit-of-measure DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class UnitBase(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    symbol: str = Field(min_length=1, max_length=16)
    is_fractional: bool = False
    is_active: bool = True


class UnitCreate(UnitBase):
    pass


class UnitUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    symbol: str | None = Field(default=None, min_length=1, max_length=16)
    is_fractional: bool | None = None
    is_active: bool | None = None


class UnitRead(ORMModel):
    id: uuid.UUID
    name: str
    symbol: str
    is_fractional: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime
