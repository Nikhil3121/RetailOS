"""Product bundle DTOs."""

from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field


class BundleComponentInput(BaseModel):
    component_variant_id: uuid.UUID
    # Numeric, not int — a combo can include 2.5 metres of fabric.
    quantity: Decimal = Field(gt=0, decimal_places=3, max_digits=14)


class BundleSet(BaseModel):
    """Replace a bundle's component list.

    Replace rather than upsert: a recipe is read as a whole, and omitting a
    component means "no longer in the combo".
    """

    components: list[BundleComponentInput] = Field(min_length=1)


class BundleComponentRead(BaseModel):
    component_variant_id: uuid.UUID
    quantity: Decimal
    product_name: str
    variant_name: str
    sku: str
