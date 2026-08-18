"""User DTOs. Split into Create / Update / Read variants so the wire contract for
each verb is explicit and validation lives in one place."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field

from app.db.models.user import UserRole
from app.schemas.common import ORMModel


class UserBase(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=255)
    role: UserRole
    store_id: uuid.UUID | None = None
    is_active: bool = True
    phone: str | None = Field(default=None, max_length=32)
    # Optional. When omitted the server generates STF-0001 / STF-0002 / etc.
    staff_code: str | None = Field(default=None, max_length=32)
    commission_pct: Decimal | None = Field(
        default=None, ge=0, le=100, decimal_places=2, max_digits=5
    )


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    role: UserRole | None = None
    store_id: uuid.UUID | None = None
    is_active: bool | None = None
    phone: str | None = Field(default=None, max_length=32)
    staff_code: str | None = Field(default=None, max_length=32)
    commission_pct: Decimal | None = Field(
        default=None, ge=0, le=100, decimal_places=2, max_digits=5
    )


class UserRead(ORMModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str
    role: UserRole
    store_id: uuid.UUID | None
    is_active: bool
    phone: str | None
    staff_code: str | None
    commission_pct: Decimal | None
    totp_enabled: bool = False
    last_login_at: datetime | None
    created_at: datetime
    updated_at: datetime
