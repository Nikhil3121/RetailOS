"""Bill-value gift schemes — "spend ₹1,000, get a water bottle".

Three promotion mechanics now live in this schema and they are deliberately
separate things:

    Coupon        takes money OFF a bill
    Loyalty       points accrued and spent over time
    RewardScheme  a free GIFT when one bill reaches a total

The gifts are bought in bulk outside the catalogue and are not SKUs, so nothing
here touches inventory. What the shop still needs is a count of what went out,
and that comes from the BILLS: every sale that earned a gift records the scheme
and the gift's name, so "how many bottles did Diwali cost us" is a GROUP BY.

A counter on the scheme row would have been easier and wrong — it drifts the
first time a bill is voided, and a number nobody trusts is worse than no number.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, ForeignKey, Numeric, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from app.db.models.store import Store


class RewardScheme(UUIDPKMixin, TimestampMixin, Base):
    """One rung of a gift ladder: a threshold and what it earns."""

    __tablename__ = "reward_schemes"

    name: Mapped[str] = mapped_column(String(128), nullable=False)

    #: The bill total at or above which this gift is earned.
    #:
    #: Compared against the FINAL amount the customer pays — after discount and
    #: including GST — because that is the number printed at the bottom of the
    #: bill and the only one a customer can check when you say "spend ₹1,000".
    min_bill_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, index=True
    )

    #: What the customer is handed. Free text: these are not catalogue items.
    gift_label: Mapped[str] = mapped_column(String(128), nullable=False)

    #: NULL means every branch. The two malls file under separate GSTINs and
    #: one may run a festival offer the other does not.
    store_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stores.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    #: Open-ended at either end. A permanent scheme needs no dates; a festival
    #: one switches itself off by the calendar rather than by somebody
    #: remembering to come back and untick it.
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)

    store: Mapped["Store | None"] = relationship(lazy="selectin")

    def runs_on(self, day: date) -> bool:
        """Is this scheme live on `day`?

        Inclusive at both ends: a scheme dated 1–15 November runs on the 15th.
        Anyone reading "valid to 15 Nov" expects the 15th to count, and an
        exclusive end date would quietly deny a gift on the last day of a
        festival — the busiest day it has.
        """
        if not self.is_active:
            return False
        if self.valid_from is not None and day < self.valid_from:
            return False
        if self.valid_to is not None and day > self.valid_to:
            return False
        return True
