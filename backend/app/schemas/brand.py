"""Brand DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, HttpUrl

from app.schemas.common import ORMModel


class BrandBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    slug: str | None = Field(
        default=None,
        max_length=160,
        description="URL-friendly identifier. Auto-derived from `name` if omitted.",
    )
    description: str | None = Field(default=None, max_length=1024)
    logo_url: HttpUrl | None = None
    is_active: bool = True


class BrandCreate(BrandBase):
    pass


class BrandUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    slug: str | None = Field(default=None, max_length=160)
    description: str | None = None
    logo_url: HttpUrl | None = None
    is_active: bool | None = None


class BrandRead(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str | None
    logo_url: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
