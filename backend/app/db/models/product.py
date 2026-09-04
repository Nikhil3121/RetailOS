"""Product + ProductVariant + ProductImage.

Every Product owns one or more Variants. A "simple" product still has exactly
one variant (auto-created on product create). Inventory attaches stock to
variants, not to products — this indirection is what lets a single logical
product carry multiple SKUs (size × color × flavour).
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from app.db.models.brand import Brand
    from app.db.models.category import Category
    from app.db.models.unit import Unit


class Product(UUIDPKMixin, TimestampMixin, Base):
    """The logical retail item. Prices live on Variants, not here."""

    __tablename__ = "products"

    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # HSN code (India GST) and tax rate applied to every variant of this product.
    hsn_code: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    tax_rate: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0.00")
    )

    brand_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("brands.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    unit_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("units.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # ---- unit conversion (buy in cartons, hold in pieces) -------------------
    #
    # `unit_id` above is the BASE unit and the ONLY unit stock is ever held in.
    # These two are presentation for goods receipt: a quantity entered in
    # purchase units is multiplied by the factor and stored in base units.
    # Holding stock in two units would mean two answers to "how many do we
    # have", which cannot be reconciled.
    purchase_unit_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("units.id", ondelete="RESTRICT"),
        nullable=True,
    )
    # Base units per purchase unit. 1 carton = 12 pieces -> 12. Always 1 when
    # no purchase unit is set, so existing products convert 1:1.
    purchase_conversion: Mapped[Decimal] = mapped_column(
        Numeric(14, 4), nullable=False, default=Decimal("1")
    )

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Raw row from legacy import (see migration 0014).
    source_data: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB().with_variant(JSON(), "sqlite"), nullable=True
    )

    brand: Mapped["Brand | None"] = relationship("Brand", back_populates="products")
    category: Mapped["Category | None"] = relationship("Category", back_populates="products")
    # `products` now has TWO foreign keys to `units` (base and purchase), so
    # both relationships must name their column — otherwise SQLAlchemy cannot
    # tell which one to join on and every product query fails.
    unit: Mapped["Unit"] = relationship("Unit", foreign_keys=[unit_id])
    purchase_unit: Mapped["Unit | None"] = relationship(
        "Unit", foreign_keys=[purchase_unit_id]
    )

    variants: Mapped[list["ProductVariant"]] = relationship(
        "ProductVariant",
        back_populates="product",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ProductVariant.sort_order",
    )
    images: Mapped[list["ProductImage"]] = relationship(
        "ProductImage",
        back_populates="product",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ProductImage.sort_order",
    )


class ProductVariant(UUIDPKMixin, TimestampMixin, Base):
    """A single SKU. Every stock movement references a variant, never a product."""

    __tablename__ = "product_variants"
    __table_args__ = (
        UniqueConstraint("sku", name="uq_product_variants_sku"),
        UniqueConstraint("barcode", name="uq_product_variants_barcode"),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product: Mapped["Product"] = relationship("Product", back_populates="variants")

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    barcode: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    # Free-form key/value attributes: {"size": "M", "color": "Black"}.
    # JSON keeps schema flexible without proliferating attribute tables.
    attributes: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict
    )

    cost_price: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0.00")
    )
    mrp: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0.00")
    )
    selling_price: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0.00")
    )

    # Inventory-intelligence thresholds (M4). All optional — leave at defaults
    # to disable the corresponding alert.
    reorder_point: Mapped[Decimal] = mapped_column(
        Numeric(14, 3), nullable=False, default=Decimal("0.000")
    )
    reorder_quantity: Mapped[Decimal] = mapped_column(
        Numeric(14, 3), nullable=False, default=Decimal("0.000")
    )
    overstock_point: Mapped[Decimal | None] = mapped_column(
        Numeric(14, 3), nullable=True
    )

    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Raw row from legacy import (see migration 0014).
    source_data: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB().with_variant(JSON(), "sqlite"), nullable=True
    )


class ProductImage(UUIDPKMixin, TimestampMixin, Base):
    """External URL to an image. File uploads land in Phase 4 with object storage."""

    __tablename__ = "product_images"

    product_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    alt_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    product: Mapped["Product"] = relationship("Product", back_populates="images")
