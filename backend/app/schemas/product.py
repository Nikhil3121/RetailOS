"""Product / Variant / Image DTOs.

The write shape (`ProductCreate`) accepts nested variants + images so the whole
product can be created in one round-trip. The read shape flattens them again
for the client. Prices ride as `Decimal` end-to-end — never `float` — to avoid
IEEE-754 rounding drift on money.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field, HttpUrl, field_validator

from app.schemas.common import ORMModel

_ZERO = Decimal("0.00")


# ---------------------------------------------------------------------------
# Variant
# ---------------------------------------------------------------------------


class VariantBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    sku: str = Field(min_length=1, max_length=64)
    barcode: str | None = Field(default=None, max_length=64)
    attributes: dict[str, Any] = Field(default_factory=dict)
    cost_price: Decimal = Field(default=_ZERO, ge=0, decimal_places=2, max_digits=12)
    mrp: Decimal = Field(default=_ZERO, ge=0, decimal_places=2, max_digits=12)
    selling_price: Decimal = Field(default=_ZERO, ge=0, decimal_places=2, max_digits=12)
    reorder_point: Decimal = Field(default=Decimal("0.000"), ge=0, decimal_places=3, max_digits=14)
    reorder_quantity: Decimal = Field(default=Decimal("0.000"), ge=0, decimal_places=3, max_digits=14)
    overstock_point: Decimal | None = Field(default=None, ge=0, decimal_places=3, max_digits=14)
    sort_order: int = 0
    is_active: bool = True

    @field_validator("barcode")
    @classmethod
    def _empty_barcode_is_null(cls, v: str | None) -> str | None:
        return v.strip() if v and v.strip() else None


class VariantCreate(VariantBase):
    pass


class VariantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    sku: str | None = Field(default=None, min_length=1, max_length=64)
    barcode: str | None = Field(default=None, max_length=64)
    attributes: dict[str, Any] | None = None
    cost_price: Decimal | None = Field(default=None, ge=0, decimal_places=2, max_digits=12)
    mrp: Decimal | None = Field(default=None, ge=0, decimal_places=2, max_digits=12)
    selling_price: Decimal | None = Field(default=None, ge=0, decimal_places=2, max_digits=12)
    reorder_point: Decimal | None = Field(default=None, ge=0, decimal_places=3, max_digits=14)
    reorder_quantity: Decimal | None = Field(default=None, ge=0, decimal_places=3, max_digits=14)
    overstock_point: Decimal | None = Field(default=None, ge=0, decimal_places=3, max_digits=14)
    sort_order: int | None = None
    is_active: bool | None = None


class VariantRead(ORMModel):
    id: uuid.UUID
    product_id: uuid.UUID
    name: str
    sku: str
    barcode: str | None
    attributes: dict[str, Any]
    cost_price: Decimal
    mrp: Decimal
    selling_price: Decimal
    reorder_point: Decimal
    reorder_quantity: Decimal
    overstock_point: Decimal | None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Image
# ---------------------------------------------------------------------------


class ImageBase(BaseModel):
    url: HttpUrl
    alt_text: str | None = Field(default=None, max_length=255)
    sort_order: int = 0


class ImageCreate(ImageBase):
    pass


class ImageRead(ORMModel):
    id: uuid.UUID
    product_id: uuid.UUID
    url: str
    alt_text: str | None
    sort_order: int


# ---------------------------------------------------------------------------
# Product
# ---------------------------------------------------------------------------


class ProductBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    hsn_code: str | None = Field(default=None, max_length=16)
    tax_rate: Decimal = Field(default=_ZERO, ge=0, le=100, decimal_places=2, max_digits=5)
    brand_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    unit_id: uuid.UUID
    is_active: bool = True


class ProductCreate(ProductBase):
    purchase_unit_id: uuid.UUID | None = None
    purchase_conversion: Decimal = Field(default=Decimal('1'), gt=0, decimal_places=4, max_digits=14)
    variants: list[VariantCreate] = Field(
        default_factory=list,
        description=(
            "At least one variant is expected. If empty, the service auto-creates a "
            "single default variant using the product name + a generated SKU."
        ),
    )
    images: list[ImageCreate] = Field(default_factory=list)


class ProductUpdate(BaseModel):
    purchase_unit_id: uuid.UUID | None = None
    purchase_conversion: Decimal | None = Field(default=None, gt=0, decimal_places=4, max_digits=14)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    hsn_code: str | None = Field(default=None, max_length=16)
    tax_rate: Decimal | None = Field(default=None, ge=0, le=100, decimal_places=2, max_digits=5)
    brand_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    unit_id: uuid.UUID | None = None
    is_active: bool | None = None


class ProductRead(ORMModel):
    purchase_unit_id: uuid.UUID | None = None
    purchase_conversion: Decimal = Decimal('1')
    id: uuid.UUID
    name: str
    description: str | None
    hsn_code: str | None
    tax_rate: Decimal
    brand_id: uuid.UUID | None
    category_id: uuid.UUID | None
    unit_id: uuid.UUID
    is_active: bool
    variants: list[VariantRead] = Field(default_factory=list)
    images: list[ImageRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class ProductSummary(ORMModel):
    """Lightweight row for product listings — omits images + full variant details."""

    id: uuid.UUID
    name: str
    hsn_code: str | None
    tax_rate: Decimal
    brand_id: uuid.UUID | None
    category_id: uuid.UUID | None
    unit_id: uuid.UUID
    is_active: bool
    variant_count: int
    primary_sku: str | None
    primary_selling_price: Decimal | None
    created_at: datetime
    updated_at: datetime
