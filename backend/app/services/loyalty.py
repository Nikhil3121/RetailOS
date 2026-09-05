"""Loyalty points — earning, redeeming, and keeping the two honest.

WHAT THIS SERVICE PROTECTS
--------------------------
Points are a LIABILITY. Every point issued is a small promise to discount a
future bill, and the failure modes are asymmetric: issuing a few too many costs
the shop money slowly, while letting the same points be spent twice costs it
money immediately and invisibly. So the redeem path is the strict one.

Three rules the code holds to:

1. THE LEDGER IS THE TRUTH. A balance is only ever changed by writing a ledger
   row in the same transaction. Nothing here sets `points_balance` on its own.

2. REDEMPTION IS LOCKED. `SELECT … FOR UPDATE` on the loyalty row before
   spending, exactly as stock balances and invoice sequences are locked. Two
   tills serving the same customer at once is not hypothetical in a shop with
   two counters, and read-then-write without a lock is how a balance goes
   negative.

3. NO FLOATS, EVER. Every figure is `Decimal`, quantised explicitly. Points are
   money in all the ways that matter.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, ValidationError
from app.db.models.customer import Customer
from app.db.models.loyalty import (
    CustomerLoyalty,
    LoyaltyKind,
    LoyaltyLedger,
    LoyaltyProgram,
    MembershipTier,
)

_ZERO = Decimal("0.00")
_POINTS = Decimal("0.01")


class LoyaltyService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------

    async def program(self) -> LoyaltyProgram | None:
        """The active program, or None when the shop runs no scheme.

        Returning None rather than inventing a default is deliberate: a shop
        that has not configured loyalty must not silently start accruing a
        liability because some default said one point per rupee.
        """
        rows = await self.db.execute(
            select(LoyaltyProgram).where(LoyaltyProgram.is_active.is_(True)).limit(1)
        )
        return rows.scalar_one_or_none()

    async def set_program(
        self,
        *,
        name: str,
        points_per_rupee: Decimal,
        redemption_rate: Decimal,
        expiry_days: int | None,
        is_active: bool = True,
    ) -> LoyaltyProgram:
        """Create or update the single active program."""
        existing = await self.program()
        if existing is None:
            existing = LoyaltyProgram()
            self.db.add(existing)

        existing.name = name
        existing.points_per_rupee = points_per_rupee
        existing.redemption_rate = redemption_rate
        existing.expiry_days = expiry_days
        existing.is_active = is_active
        await self.db.flush()
        return existing

    async def tiers(self) -> list[MembershipTier]:
        rows = await self.db.execute(
            select(MembershipTier)
            .where(MembershipTier.is_active.is_(True))
            .order_by(MembershipTier.min_lifetime_spend.asc())
        )
        return list(rows.scalars().all())

    # ------------------------------------------------------------------
    # Balances
    # ------------------------------------------------------------------

    async def _row_for(
        self, customer_id: uuid.UUID, *, lock: bool = False
    ) -> CustomerLoyalty:
        """Fetch the customer's loyalty row, creating it on first contact.

        `lock=True` takes `FOR UPDATE`, which every path that SPENDS points must
        use. Reading a balance and then writing it back without the lock lets
        two counters each see 500 points and each spend them.
        """
        stmt = select(CustomerLoyalty).where(CustomerLoyalty.customer_id == customer_id)
        if lock:
            stmt = stmt.with_for_update()

        row = (await self.db.execute(stmt)).scalar_one_or_none()
        if row is not None:
            return row

        customer = await self.db.get(Customer, customer_id)
        if customer is None:
            raise NotFoundError("Customer not found.", code="CUSTOMER_NOT_FOUND")

        row = CustomerLoyalty(customer_id=customer_id)
        self.db.add(row)
        # Flush so a concurrent caller hits the unique constraint on
        # customer_id rather than quietly creating a second balance row.
        await self.db.flush()
        return row

    async def balance(self, customer_id: uuid.UUID) -> CustomerLoyalty:
        return await self._row_for(customer_id)

    async def statement(
        self, customer_id: uuid.UUID, *, limit: int = 100
    ) -> list[LoyaltyLedger]:
        """Recent movements, newest first — the answer to "why is it this?"."""
        rows = await self.db.execute(
            select(LoyaltyLedger)
            .where(LoyaltyLedger.customer_id == customer_id)
            .order_by(LoyaltyLedger.created_at.desc(), LoyaltyLedger.id.desc())
            .limit(limit)
        )
        return list(rows.scalars().all())

    # ------------------------------------------------------------------
    # The one place a balance ever changes
    # ------------------------------------------------------------------

    async def _post(
        self,
        row: CustomerLoyalty,
        *,
        kind: LoyaltyKind,
        points_delta: Decimal,
        reason: str | None = None,
        sale_id: uuid.UUID | None = None,
        reference: str | None = None,
        expires_at: date | None = None,
        user_id: uuid.UUID | None = None,
    ) -> LoyaltyLedger:
        """Move points and write the ledger row that explains the move.

        Private, and the ONLY writer of `points_balance`. Keeping it to one
        function is what makes "the balance always equals the ledger" a property
        of the code rather than a hope.
        """
        points_delta = points_delta.quantize(_POINTS, rounding=ROUND_HALF_UP)
        new_balance = (row.points_balance + points_delta).quantize(_POINTS)

        # A negative balance would mean the shop had given away points it never
        # issued. Any path that could produce one is a bug, so it fails loudly
        # here rather than being clamped into looking fine.
        if new_balance < _ZERO:
            raise ValidationError(
                "Not enough points.",
                code="INSUFFICIENT_POINTS",
                details={
                    "balance": str(row.points_balance),
                    "requested": str(abs(points_delta)),
                },
            )

        row.points_balance = new_balance
        if points_delta > _ZERO:
            row.lifetime_earned = (row.lifetime_earned + points_delta).quantize(_POINTS)
        elif kind is LoyaltyKind.REDEEM:
            # Only a REDEEM counts as redeemed. A reversal or an expiry also
            # reduces the balance, but calling those "redeemed" would tell the
            # customer they spent points they never got the benefit of.
            row.lifetime_redeemed = (row.lifetime_redeemed - points_delta).quantize(_POINTS)

        row.last_activity_at = datetime.now(timezone.utc)

        entry = LoyaltyLedger(
            customer_id=row.customer_id,
            kind=kind,
            points_delta=points_delta,
            wallet_delta=_ZERO,
            points_balance_after=new_balance,
            wallet_balance_after=row.wallet_balance,
            sale_id=sale_id,
            reason=reason,
            reference=reference,
            expires_at=expires_at,
            created_by_user_id=user_id,
        )
        self.db.add(entry)
        await self.db.flush()
        return entry

    # ------------------------------------------------------------------
    # Earning
    # ------------------------------------------------------------------

    async def points_for(self, amount: Decimal, row: CustomerLoyalty) -> Decimal:
        """What `amount` of spend earns this customer, tier multiplier included."""
        program = await self.program()
        if program is None or amount <= _ZERO:
            return _ZERO

        multiplier = Decimal("1.000")
        if row.membership_tier_id is not None:
            tier = await self.db.get(MembershipTier, row.membership_tier_id)
            if tier is not None:
                multiplier = tier.points_multiplier

        # Rounded DOWN. A fraction of a point rounded up on every bill is the
        # shop steadily issuing points nobody earned, and it compounds.
        return (amount * program.points_per_rupee * multiplier).quantize(
            _POINTS, rounding=ROUND_DOWN
        )

    async def earn_for_sale(
        self,
        *,
        customer_id: uuid.UUID,
        sale_id: uuid.UUID,
        amount: Decimal,
        user_id: uuid.UUID | None = None,
    ) -> LoyaltyLedger | None:
        """Award points for a completed sale, and re-check the customer's tier.

        Returns None when no program is configured or the bill earns nothing —
        callers must treat loyalty as optional, because a shop that never turns
        it on still has to be able to sell things.
        """
        program = await self.program()
        if program is None:
            return None

        row = await self._row_for(customer_id, lock=True)
        points = await self.points_for(amount, row)

        # Lifetime spend counts the money regardless of whether the bill earned
        # a whole point, or tiers would stall on a shop with a low earn rate.
        row.lifetime_spend = (row.lifetime_spend + amount).quantize(_POINTS)

        entry: LoyaltyLedger | None = None
        if points > _ZERO:
            expires_at = (
                (datetime.now(timezone.utc) + timedelta(days=program.expiry_days)).date()
                if program.expiry_days
                else None
            )
            entry = await self._post(
                row,
                kind=LoyaltyKind.EARN,
                points_delta=points,
                reason="Points earned on sale",
                sale_id=sale_id,
                expires_at=expires_at,
                user_id=user_id,
            )

        await self._apply_tier(row)
        await self.db.flush()
        return entry

    async def _apply_tier(self, row: CustomerLoyalty) -> None:
        """Promote the customer to the highest tier their spend has reached.

        Promotion only. A customer is never demoted by this: a tier is
        recognition of what someone has already spent, and taking it back
        because a threshold moved is how a shop loses its best customers.
        """
        for tier in reversed(await self.tiers()):
            if row.lifetime_spend >= tier.min_lifetime_spend:
                if row.membership_tier_id != tier.id:
                    current = (
                        await self.db.get(MembershipTier, row.membership_tier_id)
                        if row.membership_tier_id
                        else None
                    )
                    if current is None or tier.min_lifetime_spend > current.min_lifetime_spend:
                        row.membership_tier_id = tier.id
                return

    # ------------------------------------------------------------------
    # Redeeming
    # ------------------------------------------------------------------

    def rupees_for_points(self, points: Decimal, program: LoyaltyProgram) -> Decimal:
        """What `points` are worth in rupees, rounded DOWN to the paisa.

        Down, because this is a discount the shop grants: rounding it up would
        give away money that was never earned.
        """
        return (points * program.redemption_rate).quantize(_POINTS, rounding=ROUND_DOWN)

    async def quote_redemption(
        self, *, customer_id: uuid.UUID, points: Decimal
    ) -> tuple[Decimal, Decimal]:
        """What redeeming `points` would be worth, WITHOUT spending them.

        Billing calls this to show "500 points = ₹125" before the customer
        commits. Returns (points, rupees). Separate from `redeem` on purpose —
        a screen that spent points merely by displaying their value would be a
        disaster at a busy counter.
        """
        program = await self.program()
        if program is None:
            raise ValidationError(
                "No loyalty program is configured.", code="NO_LOYALTY_PROGRAM"
            )

        row = await self._row_for(customer_id)
        if points > row.points_balance:
            raise ValidationError(
                "Not enough points.",
                code="INSUFFICIENT_POINTS",
                details={"balance": str(row.points_balance), "requested": str(points)},
            )
        return points, self.rupees_for_points(points, program)

    async def redeem(
        self,
        *,
        customer_id: uuid.UUID,
        points: Decimal,
        sale_id: uuid.UUID | None = None,
        reason: str | None = None,
        user_id: uuid.UUID | None = None,
    ) -> tuple[LoyaltyLedger, Decimal]:
        """Spend points. Returns the ledger row and the rupees granted."""
        if points <= _ZERO:
            raise ValidationError(
                "Redeem a positive number of points.", code="INVALID_POINTS"
            )

        program = await self.program()
        if program is None:
            raise ValidationError(
                "No loyalty program is configured.", code="NO_LOYALTY_PROGRAM"
            )

        # Locked BEFORE the balance is read. Everything after this point is
        # serialised against another till doing the same thing.
        row = await self._row_for(customer_id, lock=True)
        if points > row.points_balance:
            raise ValidationError(
                "Not enough points.",
                code="INSUFFICIENT_POINTS",
                details={"balance": str(row.points_balance), "requested": str(points)},
            )

        rupees = self.rupees_for_points(points, program)
        entry = await self._post(
            row,
            kind=LoyaltyKind.REDEEM,
            points_delta=-points,
            reason=reason or f"Redeemed for ₹{rupees}",
            sale_id=sale_id,
            user_id=user_id,
        )
        return entry, rupees

    # ------------------------------------------------------------------
    # Taking points back
    # ------------------------------------------------------------------

    async def _earned_and_reversed(
        self, sale_id: uuid.UUID
    ) -> tuple[Decimal, Decimal, uuid.UUID | None]:
        """How many points this sale granted, and how many have been taken back.

        Both figures come from the ledger rather than a counter, because a sale
        can be returned in pieces and then voided, and only the ledger knows
        what has already happened.
        """
        rows = await self.db.execute(
            select(LoyaltyLedger).where(LoyaltyLedger.sale_id == sale_id)
        )
        earned, reversed_, customer_id = _ZERO, _ZERO, None
        for r in rows.scalars().all():
            if r.kind is LoyaltyKind.EARN:
                earned += r.points_delta
                customer_id = r.customer_id
            elif r.kind is LoyaltyKind.REVERSAL:
                reversed_ += -r.points_delta
        return earned, reversed_, customer_id

    async def reverse_for_sale(
        self,
        *,
        sale_id: uuid.UUID,
        reason: str,
        user_id: uuid.UUID | None = None,
        fraction: Decimal | None = None,
    ) -> LoyaltyLedger | None:
        """Claw back points earned on a sale that was returned or voided.

        Without this, a customer could buy, collect points, return the goods for
        a full refund, and keep the points — the shop would have paid for the
        privilege of the transaction happening at all.

        `fraction` is the proportion of the bill coming back, so a partial
        return takes back a proportional share. Omit it to reverse everything,
        which is what voiding means.

        TWO CLAMPS, both deliberate:

        * Never reverse more than the sale granted in total, however many
          partial returns arrive. Reversing per-return without this cap would
          take back more points than were ever issued.
        * Never take the balance below zero. If the customer has already spent
          the points the shop absorbs it — chasing a negative would leave them
          unable to earn their way back, which is worse than the small loss.
        """
        earned, already, customer_id = await self._earned_and_reversed(sale_id)
        if customer_id is None or earned <= _ZERO:
            return None

        outstanding = earned - already
        if outstanding <= _ZERO:
            return None

        want = outstanding if fraction is None else (earned * fraction).quantize(
            _POINTS, rounding=ROUND_HALF_UP
        )
        want = min(want, outstanding)
        if want <= _ZERO:
            return None

        row = await self._row_for(customer_id, lock=True)
        take = min(want, row.points_balance)
        if take <= _ZERO:
            return None

        return await self._post(
            row,
            kind=LoyaltyKind.REVERSAL,
            points_delta=-take,
            reason=reason,
            sale_id=sale_id,
            user_id=user_id,
        )

    async def expire_due_points(self, *, today: date | None = None) -> int:
        """Lapse points whose expiry date has passed. Returns customers affected.

        WHY THIS HAS TO EXIST. `expiry_days` was already in the schema and every
        EARN row is stamped with an `expires_at`, but a date nothing acts on is
        not an expiry policy — it is a note. Left unswept, the shop's liability
        grows forever while its own configuration says otherwise, and the first
        anyone hears of it is a customer redeeming three-year-old points.

        Expiry is computed per customer as:

            points earned before the cutoff, less everything already taken off
            them since, less what has already been expired

        Subtracting redemptions matters: a customer who earned 500 points a year
        ago and has already spent them has nothing left to lapse, and expiring a
        further 500 would drive them negative for points they no longer hold.

        Idempotent. Running twice in a day expires nothing the second time,
        because the first run's EXPIRY rows are counted as already removed.
        """
        cutoff = today or datetime.now(timezone.utc).date()

        rows = await self.db.execute(
            select(LoyaltyLedger).order_by(LoyaltyLedger.created_at.asc())
        )
        earned_due: dict[uuid.UUID, Decimal] = {}
        removed: dict[uuid.UUID, Decimal] = {}

        for entry in rows.scalars().all():
            cid = entry.customer_id
            if entry.kind is LoyaltyKind.EARN:
                if entry.expires_at is not None and entry.expires_at <= cutoff:
                    earned_due[cid] = earned_due.get(cid, _ZERO) + entry.points_delta
            elif entry.points_delta < _ZERO:
                # Redemptions, reversals and past expiries all reduce what is
                # left to lapse.
                removed[cid] = removed.get(cid, _ZERO) + (-entry.points_delta)

        affected = 0
        for customer_id, due in earned_due.items():
            lapsing = due - removed.get(customer_id, _ZERO)
            if lapsing <= _ZERO:
                continue

            row = await self._row_for(customer_id, lock=True)
            take = min(lapsing, row.points_balance)
            if take <= _ZERO:
                continue

            await self._post(
                row,
                kind=LoyaltyKind.EXPIRY,
                points_delta=-take,
                reason=f"Points expired on {cutoff.isoformat()}",
            )
            affected += 1

        return affected

    async def adjust(
        self,
        *,
        customer_id: uuid.UUID,
        points: Decimal,
        reason: str,
        user_id: uuid.UUID | None = None,
    ) -> LoyaltyLedger:
        """A manager's manual correction. A reason is required, not optional."""
        if points == _ZERO:
            raise ValidationError("Adjust by a non-zero amount.", code="INVALID_POINTS")
        row = await self._row_for(customer_id, lock=True)
        return await self._post(
            row,
            kind=LoyaltyKind.ADJUSTMENT,
            points_delta=points,
            reason=reason,
            user_id=user_id,
        )
