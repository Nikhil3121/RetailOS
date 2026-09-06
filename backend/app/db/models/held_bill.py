"""A parked cart, shared across the counters of one branch.

Held bills used to live in `localStorage` — which means they lived in ONE
BROWSER. Two tills at the same mall could not see each other's parked bills, so
a customer who stepped away at counter 1 could not be finished at counter 2.

A HELD BILL IS NOT A SALE. It has no invoice number, no stock movement and no
money, and it may never become any of those. The cart is therefore stored as
JSON rather than as `sale_lines`: giving it rows in `sales` would put a
non-transaction into every revenue query ever written against that table, and
somebody would eventually have to remember to exclude it.
"""

from __future__ import annotations

import uuid
from typing import Any, TYPE_CHECKING

from sqlalchemy import ForeignKey, JSON, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from app.db.models.customer import Customer
    from app.db.models.store import Store


class HeldBill(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "held_bills"

    #: Scoped to a branch, not to a terminal. That is the whole point — any
    #: till in the same mall can pick it up.
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stores.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("customers.id", ondelete="SET NULL"), nullable=True
    )
    salesperson_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    #: What the cashier calls it — "blue saree lady", "Sharma ji". Free text,
    #: because that is how a counter actually identifies a parked bill.
    label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    cart: Mapped[dict[str, Any]] = mapped_column(
        JSONB().with_variant(JSON(), "sqlite"), nullable=False
    )

    held_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: Which till parked it. Recorded so a shop can see where to look for the
    #: customer, not to restrict who may resume it.
    terminal_uuid: Mapped[str | None] = mapped_column(String(64), nullable=True)

    store: Mapped["Store"] = relationship(lazy="raise")
    customer: Mapped["Customer | None"] = relationship(lazy="selectin")
