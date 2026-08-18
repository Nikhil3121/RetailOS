"""Customer — the counter-party of a sale (walk-in shoppers + B2B accounts)."""

from __future__ import annotations

from datetime import date

from sqlalchemy import Boolean, Date, String, UniqueConstraint
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
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
