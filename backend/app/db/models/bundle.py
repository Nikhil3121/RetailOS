"""Product bundles — a combo sold as one line, stocked as its parts."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Numeric, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from app.db.models.product import ProductVariant


class ProductBundleItem(UUIDPKMixin, TimestampMixin, Base):
    """One component of one bundle.

    STOCK MOVES FOR THE COMPONENTS, NEVER FOR THE BUNDLE. A "saree + blouse"
    combo is a way of selling, not a thing on a shelf — there is no box of it in
    the stockroom. Holding stock against the bundle as well would count the same
    physical garment twice.
    """

    __tablename__ = "product_bundle_items"
    __table_args__ = (
        UniqueConstraint(
            "bundle_variant_id",
            "component_variant_id",
            name="uq_bundle_items_bundle_component",
        ),
    )

    bundle_variant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("product_variants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    component_variant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        # RESTRICT: a component is a real product. Deleting one that a combo
        # depends on must fail loudly rather than silently gutting the recipe.
        ForeignKey("product_variants.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # Numeric, not Integer — a combo can include 2.5 metres of fabric.
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)

    bundle: Mapped["ProductVariant"] = relationship(
        "ProductVariant", foreign_keys=[bundle_variant_id]
    )
    component: Mapped["ProductVariant"] = relationship(
        "ProductVariant", foreign_keys=[component_variant_id]
    )
