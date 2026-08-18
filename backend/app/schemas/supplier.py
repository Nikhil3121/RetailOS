"""Supplier DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ORMModel


class SupplierBase(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    contact_person: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    gstin: str | None = Field(default=None, min_length=15, max_length=15)
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    country: str = Field(default="IN", min_length=2, max_length=2)
    notes: str | None = Field(default=None, max_length=1024)
    is_active: bool = True


class SupplierCreate(SupplierBase):
    pass


class SupplierUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    contact_person: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    gstin: str | None = Field(default=None, min_length=15, max_length=15)
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    country: str | None = Field(default=None, min_length=2, max_length=2)
    notes: str | None = None
    is_active: bool | None = None


class SupplierRead(ORMModel):
    id: uuid.UUID
    code: str
    name: str
    contact_person: str | None
    phone: str | None
    email: EmailStr | None
    gstin: str | None
    address_line1: str | None
    address_line2: str | None
    city: str | None
    state: str | None
    postal_code: str | None
    country: str
    notes: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
