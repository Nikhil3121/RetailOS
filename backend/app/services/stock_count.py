"""Physical stock audit — count sheets, variances, and posting them.

THE CENTRAL RULE: A COUNT POSTS ITS VARIANCE, NOT ITS TOTAL
------------------------------------------------------------
A sheet is filled in at 6pm and posted at 9pm, with three hours of sales in
between. Posting "set the balance to what was counted" would silently re-add
every unit sold in those hours — stock overstated by exactly the evening's
takings, and nothing in the ledger to show for it.

So each line snapshots `system_qty` when it is ENTERED, and posting applies
`counted_qty − system_qty` as a delta. Real movement since the count survives
on top of the correction, which is the only reading that is right whether the
shop counted at close or kept trading through it.

WHAT POSTING WILL NOT DO
------------------------
Zero a variant that is not on the sheet. A partial count of the saree section
must never write off the shirts: "we did not look" and "there are none" are
different facts, and treating them alike destroys an entire inventory in one
click. Only lines actually on the sheet are posted.

Post twice. POSTED is terminal. Re-opening a posted sheet would let the same
variance be applied again, and the ledger rows it wrote cannot be unwritten.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.db.models.inventory import MovementKind, StockBalance
from app.db.models.product import Product, ProductVariant
from app.db.models.stock_count import StockCount, StockCountLine, StockCountStatus
from app.db.models.store import Store
from app.schemas.stock_count import (
    StockCountCreate,
    StockCountLineInput,
    StockCountUpdate,
)
from app.services.inventory import InventoryService

_ZERO = Decimal("0.000")


class StockCountService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------
    async def get(self, count_id: uuid.UUID) -> StockCount:
        count = await self.db.scalar(
            select(StockCount)
            .where(StockCount.id == count_id)
            # Down to the PRODUCT, not just the variant. The count sheet shows
            # "Saree · Red · AU-1"; stopping at the variant leaves the product
            # name to a lazy load that fires during serialisation, outside the
            # async context, and takes the whole request down.
            .options(
                selectinload(StockCount.lines)
                .selectinload(StockCountLine.variant)
                .selectinload(ProductVariant.product)
            )
        )
        if count is None:
            raise NotFoundError("Stock count not found.", code="STOCK_COUNT_NOT_FOUND")
        return count

    async def list(
        self,
        *,
        store_id: uuid.UUID | None = None,
        status: StockCountStatus | None = None,
        limit: int = 100,
    ) -> list[StockCount]:
        stmt = select(StockCount).order_by(StockCount.created_at.desc()).limit(limit)
        if store_id is not None:
            stmt = stmt.where(StockCount.store_id == store_id)
        if status is not None:
            stmt = stmt.where(StockCount.status == status)
        return list((await self.db.scalars(stmt)).all())

    # ------------------------------------------------------------------
    # Sheet lifecycle
    # ------------------------------------------------------------------
    async def create(
        self, payload: StockCountCreate, *, user_id: uuid.UUID | None
    ) -> StockCount:
        store = await self.db.get(Store, payload.store_id)
        if store is None:
            raise NotFoundError("Store not found.", code="STORE_NOT_FOUND")

        # Checked before insert so the operator gets "that reference is already
        # used" rather than a constraint violation they cannot act on.
        clash = await self.db.scalar(
            select(StockCount.id).where(
                StockCount.store_id == payload.store_id,
                StockCount.reference == payload.reference,
            )
        )
        if clash is not None:
            raise ConflictError(
                f"A count called {payload.reference!r} already exists at this store.",
                code="STOCK_COUNT_REFERENCE_TAKEN",
            )

        count = StockCount(
            store_id=payload.store_id,
            reference=payload.reference,
            scope=payload.scope,
            is_blind=payload.is_blind,
            notes=payload.notes,
            status=StockCountStatus.DRAFT,
            counted_by_user_id=user_id,
        )
        self.db.add(count)
        await self.db.flush()
        await self.db.refresh(count, ["lines"])
        return count

    async def update(self, count_id: uuid.UUID, payload: StockCountUpdate) -> StockCount:
        count = await self.get(count_id)
        self._assert_open(count)

        data = payload.model_dump(exclude_unset=True)
        if "reference" in data and data["reference"] != count.reference:
            clash = await self.db.scalar(
                select(StockCount.id).where(
                    StockCount.store_id == count.store_id,
                    StockCount.reference == data["reference"],
                    StockCount.id != count.id,
                )
            )
            if clash is not None:
                raise ConflictError(
                    f"A count called {data['reference']!r} already exists at this store.",
                    code="STOCK_COUNT_REFERENCE_TAKEN",
                )
        for field, value in data.items():
            setattr(count, field, value)
        await self.db.flush()
        return count

    async def cancel(self, count_id: uuid.UUID) -> StockCount:
        count = await self.get(count_id)
        self._assert_open(count)
        count.status = StockCountStatus.CANCELLED
        await self.db.flush()
        return count

    async def delete(self, count_id: uuid.UUID) -> None:
        """Remove a sheet entirely. Only ever a draft.

        A posted sheet is the evidence for ledger rows that still exist, so
        deleting it would leave stock movements no one can explain.
        """
        count = await self.get(count_id)
        if count.status == StockCountStatus.POSTED:
            raise ConflictError(
                "A posted count cannot be deleted — it is the record behind "
                "stock movements that already exist.",
                code="STOCK_COUNT_POSTED",
            )
        await self.db.delete(count)
        await self.db.flush()

    # ------------------------------------------------------------------
    # Lines
    # ------------------------------------------------------------------
    async def upsert_lines(
        self, count_id: uuid.UUID, lines: list[StockCountLineInput]
    ) -> StockCount:
        """Save counted quantities, snapshotting what the books say right now.

        Re-counting a variant REPLACES its line rather than adding a second
        one. A counter who finds a missed box and re-enters the rack expects
        the sheet to hold one figure per item, and two rows would post the
        variance twice.

        The system snapshot is refreshed on a re-count, deliberately: the
        second count is a fresh observation, and pairing it with a stale
        expectation would compute a variance against a moment nobody looked.
        """
        count = await self.get(count_id)
        self._assert_open(count)

        existing = {line.variant_id: line for line in count.lines}

        # One query for every variant on the batch rather than one per line —
        # a rack of 200 items should not be 200 round trips to the database.
        variant_ids = [line.variant_id for line in lines]
        found = set(
            (
                await self.db.scalars(
                    select(ProductVariant.id).where(ProductVariant.id.in_(variant_ids))
                )
            ).all()
        )
        missing = [str(v) for v in variant_ids if v not in found]
        if missing:
            raise NotFoundError(
                "Some counted items are not in the catalogue.",
                code="VARIANT_NOT_FOUND",
                details={"variant_ids": missing[:20]},
            )

        balances = {
            row.variant_id: row.quantity
            for row in (
                await self.db.scalars(
                    select(StockBalance).where(
                        StockBalance.store_id == count.store_id,
                        StockBalance.variant_id.in_(variant_ids),
                    )
                )
            ).all()
        }

        for entry in lines:
            # A variant with no balance row has never moved at this store,
            # which is zero — not unknown. Treating it as unknown would make
            # every opening count unpostable, which is the exact case this
            # whole feature exists for.
            system_qty = balances.get(entry.variant_id, _ZERO) or _ZERO
            variance = entry.counted_qty - system_qty

            line = existing.get(entry.variant_id)
            if line is None:
                line = StockCountLine(
                    count_id=count.id,
                    variant_id=entry.variant_id,
                    system_qty=system_qty,
                    counted_qty=entry.counted_qty,
                    variance=variance,
                    reason=entry.reason,
                )
                self.db.add(line)
                count.lines.append(line)
            else:
                line.system_qty = system_qty
                line.counted_qty = entry.counted_qty
                line.variance = variance
                line.reason = entry.reason

        await self.db.flush()
        return await self.get(count_id)

    async def delete_line(self, count_id: uuid.UUID, line_id: uuid.UUID) -> StockCount:
        count = await self.get(count_id)
        self._assert_open(count)
        for line in count.lines:
            if line.id == line_id:
                # Removed from the COLLECTION, not deleted directly. The
                # relationship is delete-orphan, so this still deletes the row
                # — and it also drops the line from the parent's already-loaded
                # collection. A bare session.delete() leaves that collection
                # cached, and the very next read hands back the line the
                # operator just removed.
                count.lines.remove(line)
                await self.db.flush()
                return await self.get(count_id)
        raise NotFoundError("Count line not found.", code="STOCK_COUNT_LINE_NOT_FOUND")

    # ------------------------------------------------------------------
    # Posting
    # ------------------------------------------------------------------
    async def post(
        self, count_id: uuid.UUID, *, user_id: uuid.UUID | None
    ) -> tuple[StockCount, int, Decimal, list[uuid.UUID]]:
        """Apply the sheet's variances to the stock ledger.

        Returns the sheet, how many movements were written, the net variance,
        and the variants whose balance moved between counting and posting.

        Runs inside the caller's transaction: the sheet is marked POSTED and
        the ledger rows are written together or not at all. A sheet that says
        posted with no movements behind it would be unfixable — you cannot
        tell whether the stock was corrected or the write failed halfway.
        """
        count = await self.get(count_id)
        self._assert_open(count)

        if not count.lines:
            raise ValidationError(
                "There is nothing on this count sheet to post.",
                code="STOCK_COUNT_EMPTY",
            )

        inventory = InventoryService(self.db)
        posted = 0
        net = _ZERO
        drifted: list[uuid.UUID] = []

        # Read the current balances once, purely to REPORT drift. They are
        # never used to recompute the variance — that figure was fixed when
        # the line was entered, and re-deriving it here is exactly the bug
        # this design exists to avoid.
        current = {
            row.variant_id: row.quantity
            for row in (
                await self.db.scalars(
                    select(StockBalance).where(
                        StockBalance.store_id == count.store_id,
                        StockBalance.variant_id.in_([l.variant_id for l in count.lines]),
                    )
                )
            ).all()
        }

        for line in count.lines:
            if (current.get(line.variant_id, _ZERO) or _ZERO) != line.system_qty:
                drifted.append(line.variant_id)

            if line.variance == 0:
                # Nothing to record. An empty ledger row would say a movement
                # happened when none did, and an audit is harder to read for
                # every one of them.
                continue

            reason = f"Stock count {count.reference}"
            if line.reason:
                reason = f"{reason} — {line.reason}"

            await inventory.post_movement(
                variant_id=line.variant_id,
                store_id=count.store_id,
                delta=line.variance,
                kind=MovementKind.ADJUSTMENT,
                reference_type="stock_count",
                reference_id=count.id,
                reason=reason[:255],
                created_by_user_id=user_id,
                # A count IS the physical truth. If the books say 3 and the
                # shelf says 0 while 2 more were sold in between, the honest
                # balance is negative and the shop needs to SEE that, not be
                # blocked from recording what is actually there. The negative
                # stock report is what surfaces it afterwards.
                allow_negative=True,
            )
            posted += 1
            net += line.variance

        count.status = StockCountStatus.POSTED
        count.posted_by_user_id = user_id
        count.posted_at = datetime.now(timezone.utc).isoformat()
        await self.db.flush()
        return await self.get(count_id), posted, net, drifted

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _assert_open(count: StockCount) -> None:
        if count.status == StockCountStatus.POSTED:
            raise ConflictError(
                "This count has already been posted. Start a new count to "
                "correct it — re-posting would apply the same variance twice.",
                code="STOCK_COUNT_POSTED",
            )
        if count.status == StockCountStatus.CANCELLED:
            raise ConflictError(
                "This count was cancelled.", code="STOCK_COUNT_CANCELLED"
            )
