"""Customer — the counter-party of a sale (walk-in shoppers + B2B accounts)."""

from __future__ import annotations

import uuid

from datetime import date
from typing import Any

from sqlalchemy import Boolean, Date, ForeignKey, JSON, String, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class Customer(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "customers"
    # Phone is the natural unique key for a walk-in customer. Nullable so a
    # cash sale without capture still works, but when present it's enforced.
    __table_args__ = (UniqueConstraint("phone", name="uq_customers_phone"),)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    # B2B invoicing (GSTIN on the invoice) — optional for walk-ins.
    gstin: Mapped[str | None] = mapped_column(String(15), nullable=True)
    company_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    anniversary: Mapped[date | None] = mapped_column(Date, nullable=True)

    address_line1: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(128), nullable=True)
    state: Mapped[str | None] = mapped_column(String(128), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    country: Mapped[str] = mapped_column(String(2), nullable=False, default="IN")

    notes: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # Which rate card this customer buys on. NULL means the default list, and
    # if there is no default, the variant's own selling_price.
    price_list_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("price_lists.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Raw row from legacy import — Richie fields with no direct home in RetailOS
    # (spouse_name, loyalty_card_no, caste, etc.) live here. See migration 0014.
    source_data: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB().with_variant(JSON(), "sqlite"), nullable=True
    )
