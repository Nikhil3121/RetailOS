"""Day-session lifecycle. Exactly one OPEN session per store at any time."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.db.models.day_session import DaySession, DayStatus
from app.db.models.sale import PaymentMethod, Sale, SalePayment, SaleStatus
from app.db.models.store import Store
from app.schemas.day_session import (
    CloseSessionRequest,
    DaySessionRead,
    DaySessionSummary,
    OpenSessionRequest,
)


_ZERO = Decimal("0.00")


class DaySessionService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def open(
        self, payload: OpenSessionRequest, *, user_id: uuid.UUID | None
    ) -> DaySession:
        store = await self.db.get(Store, payload.store_id)
        if store is None:
            raise NotFoundError("Store not found.", code="STORE_NOT_FOUND")

        existing = await self._get_open_for_store(payload.store_id)
        if existing is not None:
            raise ConflictError(
                "This store already has an open session — close it first.",
                code="DAY_SESSION_ALREADY_OPEN",
                details={"session_id": str(existing.id)},
            )

        session = DaySession(
            store_id=payload.store_id,
            status=DayStatus.OPEN,
            opened_by_user_id=user_id,
            opened_at=datetime.now(timezone.utc),
            opening_cash=payload.opening_cash,
            notes=payload.notes,
        )
        self.db.add(session)
        await self.db.flush()
        return session

    async def close(
        self,
        session_id: uuid.UUID,
        payload: CloseSessionRequest,
        *,
        user_id: uuid.UUID | None,
    ) -> DaySession:
        session = await self.db.get(DaySession, session_id)
        if session is None:
            raise NotFoundError("Session not found.", code="DAY_SESSION_NOT_FOUND")
        if session.status is not DayStatus.OPEN:
            raise ConflictError(
                "Session is already closed.", code="DAY_SESSION_ALREADY_CLOSED"
            )

        # Expected cash = opening + cash payments received during the session.
        expected = await self.recompute_expected_cash(session)

        session.status = DayStatus.CLOSED
        session.closed_by_user_id = user_id
        session.closed_at = datetime.now(timezone.utc)
        session.counted_cash = payload.counted_cash
        session.expected_cash = expected
        session.cash_diff = payload.counted_cash - expected
        if payload.notes:
            session.notes = (
                f"{session.notes}\n{payload.notes}" if session.notes else payload.notes
            )
        await self.db.flush()
        return session

    async def recent_for_store(
        self, store_id: uuid.UUID, limit: int = 10
    ) -> list[DaySession]:
        """Recent sessions for a store, newest first. Read-only.

        `get_open_for_store` deliberately returns only the OPEN session, which
        left a closed shift - including one restated after close - impossible
        for any client to display. This is the read path for that.
        """
        rows = await self.db.scalars(
            select(DaySession)
            .where(DaySession.store_id == store_id)
            .order_by(DaySession.opened_at.desc())
            .limit(limit)
        )
        return list(rows.all())

    async def recompute_expected_cash(self, session: DaySession) -> Decimal:
        """Opening float plus every cash payment booked against this session.

        Public because a late-arriving offline sale has to restate a closed
        shift, and that restatement must use the SAME arithmetic the original
        close used. Two implementations would eventually disagree, and the
        disagreement would look like a till discrepancy.
        """
        return session.opening_cash + await self._cash_taken_during(session.id)

    async def get_open_for_store(self, store_id: uuid.UUID) -> DaySession | None:
        return await self._get_open_for_store(store_id)

    async def summary(self, session_id: uuid.UUID) -> DaySessionSummary:
        session = await self.db.get(DaySession, session_id)
        if session is None:
            raise NotFoundError("Session not found.", code="DAY_SESSION_NOT_FOUND")

        totals = await self._sales_totals(session_id)
        cash = totals.get(PaymentMethod.CASH, _ZERO)
        expected = session.opening_cash + cash
        return DaySessionSummary(
            session=DaySessionRead.model_validate(session),
            sales_count=int(totals.get("_count", 0)),
            sales_total=totals.get("_gross", _ZERO),
            cash_sales_total=cash,
            card_sales_total=totals.get(PaymentMethod.CARD, _ZERO),
            upi_sales_total=totals.get(PaymentMethod.UPI, _ZERO),
            other_sales_total=totals.get(PaymentMethod.OTHER, _ZERO),
            expected_cash=expected,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    async def _get_open_for_store(self, store_id: uuid.UUID) -> DaySession | None:
        stmt = (
            select(DaySession)
            .where(DaySession.store_id == store_id, DaySession.status == DayStatus.OPEN)
            .order_by(DaySession.opened_at.desc())
            .limit(1)
        )
        return await self.db.scalar(stmt)

    async def _cash_taken_during(self, session_id: uuid.UUID) -> Decimal:
        stmt = (
            select(func.coalesce(func.sum(SalePayment.amount), 0))
            .join(Sale, Sale.id == SalePayment.sale_id)
            .where(
                Sale.day_session_id == session_id,
                Sale.status == SaleStatus.COMPLETED,
                SalePayment.method == PaymentMethod.CASH,
            )
        )
        return Decimal(str(await self.db.scalar(stmt) or 0))

    async def _sales_totals(self, session_id: uuid.UUID) -> dict:
        # Grab per-method payment totals and the sale count in one lightweight pass.
        pay_stmt = (
            select(SalePayment.method, func.coalesce(func.sum(SalePayment.amount), 0))
            .join(Sale, Sale.id == SalePayment.sale_id)
            .where(Sale.day_session_id == session_id, Sale.status == SaleStatus.COMPLETED)
            .group_by(SalePayment.method)
        )
        totals: dict = {}
        for method, total in (await self.db.execute(pay_stmt)).all():
            totals[method] = Decimal(str(total))

        count_stmt = (
            select(func.count(Sale.id), func.coalesce(func.sum(Sale.grand_total), 0))
            .where(Sale.day_session_id == session_id, Sale.status == SaleStatus.COMPLETED)
        )
        row = (await self.db.execute(count_stmt)).one()
        totals["_count"] = int(row[0] or 0)
        totals["_gross"] = Decimal(str(row[1] or 0))
        return totals
