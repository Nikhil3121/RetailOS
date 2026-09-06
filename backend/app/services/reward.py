"""Gift schemes — deciding what a bill has earned, and what it is short of.

ONE FUNCTION DECIDES, AND BOTH CALLERS USE IT
---------------------------------------------
`evaluate()` answers both questions at once:

    earned   the gift this bill has already qualified for
    next     the next rung up, and how far away it is

The billing screen calls it on every keystroke to show "₹180 more for a steel
glass", and the sale service calls it once when the bill is saved to record
what was given. THE SAME FUNCTION, deliberately — if the screen and the ledger
used different logic, a customer could be promised a bottle and not get one,
which is the single worst outcome this feature has.

That is the same rule `PriceListService.resolve` follows for prices.

HIGHEST RUNG ONLY
-----------------
A ₹2,000 bill earns the steel glass, not the glass AND the bottle. That is how
these promotions normally run, and it is the cheaper reading — so it is the one
that must be deliberate rather than accidental. Changing it to cumulative is a
change here and nowhere else.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_day import business_date
from app.core.exceptions import NotFoundError
from app.db.models.reward import RewardScheme

_ZERO = Decimal("0.00")


@dataclass
class RewardOutcome:
    """What this bill has earned, and what it is short of."""

    earned: RewardScheme | None
    next_scheme: RewardScheme | None
    #: How much more the bill needs to reach `next_scheme`. Zero when there is
    #: no next rung. Always positive when there is.
    amount_to_next: Decimal


class RewardService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def list_schemes(
        self,
        *,
        store_id: uuid.UUID | None = None,
        include_inactive: bool = False,
    ) -> list[RewardScheme]:
        """Every scheme, cheapest rung first — the order they read as a ladder.

        When `store_id` is given, schemes for that branch AND the ones marked
        for every branch are returned, because both apply there.
        """
        stmt = select(RewardScheme)
        if store_id is not None:
            stmt = stmt.where(
                or_(RewardScheme.store_id == store_id, RewardScheme.store_id.is_(None))
            )
        if not include_inactive:
            stmt = stmt.where(RewardScheme.is_active.is_(True))

        rows = await self.db.execute(stmt.order_by(RewardScheme.min_bill_amount.asc()))
        return list(rows.scalars().all())

    async def get(self, scheme_id: uuid.UUID) -> RewardScheme:
        scheme = await self.db.get(RewardScheme, scheme_id)
        if scheme is None:
            raise NotFoundError("Reward scheme not found.", code="REWARD_NOT_FOUND")
        return scheme

    # ------------------------------------------------------------------
    # The decision
    # ------------------------------------------------------------------

    async def evaluate(
        self,
        *,
        store_id: uuid.UUID,
        amount: Decimal,
        on_day: date | None = None,
    ) -> RewardOutcome:
        """What `amount` earns at `store_id` today.

        `amount` is the FINAL bill total — after discount, including GST —
        because that is the number printed at the bottom of the bill and the
        only one a customer can check against "spend ₹1,000".
        """
        # The SHOP's calendar date, not the server's and not UTC's.
        #
        # A scheme's valid_from/valid_to are typed by a manager thinking in
        # their own calendar. Comparing them against a UTC date means a
        # scheme dated "15 November" does not fire until 05:30 that morning in
        # India — several hours into the busiest day of a festival, and
        # precisely when it was meant to be running.
        day = on_day or business_date()

        live = [
            s
            for s in await self.list_schemes(store_id=store_id)
            if s.runs_on(day)
        ]
        if not live:
            return RewardOutcome(None, None, _ZERO)

        # Sorted ascending by list_schemes, so the last one met is the best one.
        earned = None
        next_scheme = None
        for scheme in live:
            if amount >= scheme.min_bill_amount:
                earned = scheme
            elif next_scheme is None:
                next_scheme = scheme

        gap = _ZERO
        if next_scheme is not None:
            gap = (next_scheme.min_bill_amount - amount).quantize(Decimal("0.01"))

        return RewardOutcome(earned, next_scheme, gap)

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    async def create(self, **fields) -> RewardScheme:  # noqa: ANN003
        scheme = RewardScheme(**fields)
        self.db.add(scheme)
        await self.db.flush()
        return scheme

    async def update(self, scheme_id: uuid.UUID, changes: dict) -> RewardScheme:
        scheme = await self.get(scheme_id)
        for field, value in changes.items():
            setattr(scheme, field, value)
        await self.db.flush()
        return scheme

    async def delete(self, scheme_id: uuid.UUID) -> None:
        """Remove a scheme.

        Bills that earned a gift under it keep their `reward_label`, because it
        is snapshotted rather than joined. Deleting a finished promotion must
        not blank out what customers were actually handed.
        """
        scheme = await self.get(scheme_id)
        await self.db.delete(scheme)
        await self.db.flush()
