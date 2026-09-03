"""Price lists — wholesale, retail, dealer.

M.S. Mall sells the same item at different rates to different people. Until now
a variant carried exactly one `selling_price`, so a wholesale bill meant the
cashier remembering the rate and typing it on every line, with nothing recording
what SHOULD have been charged. An error was indistinguishable from a deliberate
discount.

Two tables:

  price_lists        the named rate card — "Wholesale", "Retail", "Dealer"
  price_list_items   one rate, for one variant, on one list

A customer points at a list. Anything not overridden on that list falls back to
the variant's own `selling_price`, so a new list starts empty and useful rather
than requiring a rate for all 9,000 variants before it can be used at all.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Numeric, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from app.db.models.product import ProductVariant


class PriceList(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "price_lists"
    __table_args__ = (UniqueConstraint("code", name="uq_price_lists_code"),)

    code: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # The list used for a customer who has none of their own — normally
    # "Retail". At most one may be default; the service enforces it, because a
    # partial unique index is not portable to SQLite where the tests run.
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    items: Mapped[list["PriceListItem"]] = relationship(
        "PriceListItem",
        back_populates="price_list",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class PriceListItem(UUIDPKMixin, TimestampMixin, Base):
    """One rate on one list. Absence means "use the variant's own price"."""

    __tablename__ = "price_list_items"
    __table_args__ = (
        UniqueConstraint(
            "price_list_id", "variant_id", name="uq_price_list_items_list_variant"
        ),
    )

    price_list_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("price_lists.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        # RESTRICT: deleting a variant that is priced on a list should fail
        # loudly rather than silently reverting those customers to retail.
        ForeignKey("product_variants.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # Same precision as ProductVariant.selling_price — the two are substituted
    # for one another at billing time and must never differ in shape.
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    price_list: Mapped["PriceList"] = relationship("PriceList", back_populates="items")
    variant: Mapped["ProductVariant"] = relationship("ProductVariant")
