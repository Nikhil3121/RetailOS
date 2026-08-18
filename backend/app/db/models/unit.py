"""Unit of measure — the atom every quantity in the system is expressed in.

Example rows: (name='Piece', symbol='pc', is_fractional=False),
              (name='Kilogram', symbol='kg', is_fractional=True).
"""

from __future__ import annotations

from sqlalchemy import Boolean, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class Unit(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "units"
    __table_args__ = (UniqueConstraint("symbol", name="uq_units_symbol"),)

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    symbol: Mapped[str] = mapped_column(String(16), nullable=False)
    # True for units where 0.5, 1.25 etc make sense (kg, L). False for pieces.
    is_fractional: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
