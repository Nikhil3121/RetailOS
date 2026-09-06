"""Store ORM model — one row per physical retail location.

Stores are the tenancy unit inside a single-organization deployment. Later phases
add a parent Organization row above this for the multi-tenant SaaS build-out.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from app.db.models.user import User


class Store(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "stores"
    __table_args__ = (UniqueConstraint("code", name="uq_stores_code"),)

    code: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address_line1: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(128), nullable=True)
    state: Mapped[str | None] = mapped_column(String(128), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    country: Mapped[str] = mapped_column(String(2), nullable=False, default="IN")

    # GST (India) — 15 chars. Optional so multi-country deployments work.
    gstin: Mapped[str | None] = mapped_column(String(15), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Free text printed under the totals on this branch's bills — "Happy Holi",
    # a festival greeting, a return-policy line. Per store: the two branches are
    # separate businesses under separate GSTINs.
    receipt_message: Mapped[str | None] = mapped_column(String(280), nullable=True)

    # This branch's identifier in the outgoing Richie Retail system: "1" for
    # MS MALL (Thana Road), "3" for MS MALL 2 (GT Road). Written during the
    # legacy import so imported rows can be matched to a branch, and kept
    # afterwards so a re-run or a later reconciliation can find its way back.
    legacy_code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)

    # This branch's product series label — "MS1", "MS2". Used to default the
    # origin of a SKU created by hand later; never consulted after that.
    sku_prefix: Mapped[str | None] = mapped_column(String(16), nullable=True)

    is_active: Mapped[bool] = mapped_column(nullable=False, default=True)

    users: Mapped[list["User"]] = relationship("User", back_populates="store")
