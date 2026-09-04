"""Store DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ORMModel


class StoreBase(BaseModel):
    receipt_message: str | None = Field(default=None, max_length=280)
    code: str = Field(min_length=1, max_length=32, description="Unique short code, e.g. 'DEL01'")
    name: str = Field(min_length=1, max_length=255)
    address_line1: str | None = Field(default=None, max_length=255)
    address_line2: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=128)
    state: str | None = Field(default=None, max_length=128)
    postal_code: str | None = Field(default=None, max_length=16)
    country: str = Field(default="IN", min_length=2, max_length=2, description="ISO 3166-1 alpha-2")
    gstin: str | None = Field(default=None, min_length=15, max_length=15)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    is_active: bool = True


class StoreCreate(StoreBase):
    pass


class StoreUpdate(BaseModel):
    receipt_message: str | None = Field(default=None, max_length=280)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    country: str | None = Field(default=None, min_length=2, max_length=2)
    gstin: str | None = Field(default=None, min_length=15, max_length=15)
    phone: str | None = None
    email: EmailStr | None = None
    is_active: bool | None = None


class StoreRead(ORMModel):
    receipt_message: str | None = None
    id: uuid.UUID
    code: str
    name: str
    address_line1: str | None
    address_line2: str | None
    city: str | None
    state: str | None
    postal_code: str | None
    country: str
    gstin: str | None
    phone: str | None
    email: EmailStr | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
