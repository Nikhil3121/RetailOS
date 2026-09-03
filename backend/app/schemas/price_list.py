"""Price list DTOs."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class PriceListCreate(BaseModel):
    code: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9._-]+$")
    name: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    is_default: bool = False
    is_active: bool = True


class PriceListUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    is_default: bool | None = None
    is_active: bool | None = None


class PriceListRead(ORMModel):
    id: uuid.UUID
    code: str
    name: str
    description: str | None
    is_default: bool
    is_active: bool


class PriceListItemInput(BaseModel):
    variant_id: uuid.UUID
    price: Decimal = Field(ge=0, decimal_places=2, max_digits=12)


class PriceListItemsSet(BaseModel):
    """Upsert, not replace — rates absent from the body are left alone."""

    items: list[PriceListItemInput] = Field(min_length=1)


class PriceListItemRead(ORMModel):
    id: uuid.UUID
    price_list_id: uuid.UUID
    variant_id: uuid.UUID
    price: Decimal


class ResolvedPrice(BaseModel):
    """What one variant costs for one customer, and where that came from."""

    variant_id: uuid.UUID
    price: Decimal
    # The variant's own selling_price, so a UI can show "Retail ₹899" struck
    # through beside the wholesale rate without a second lookup.
    base_price: Decimal
    price_list_id: uuid.UUID | None
    source: Literal["price_list", "variant"]


class PriceResolveRequest(BaseModel):
    customer_id: uuid.UUID | None = None
    variant_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
