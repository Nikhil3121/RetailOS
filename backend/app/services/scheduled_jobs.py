"""Scheduled jobs — run periodically by APScheduler.

Every job opens its own DB session so it stays isolated from any concurrent
request. Each job is idempotent: re-running never double-counts. Failures
never crash the scheduler; they're logged and swallowed.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from app.core.logging import get_logger
from app.db.models.notification import NotificationKind, NotificationSeverity
from app.db.session import session_scope
from app.schemas.inventory_intelligence import StockCategory
from app.services.inventory_intelligence import InventoryIntelligenceService
from app.services.notification import NotificationService

log = get_logger("scheduler")


async def low_stock_scan() -> None:
    """Check for low + out-of-stock lines and fire notifications per active rule."""
    try:
        async with session_scope() as db:
            intel = InventoryIntelligenceService(db)
            alerts = await intel.stock_alerts(
                categories={StockCategory.LOW, StockCategory.OUT_OF_STOCK},
            )
            if not alerts:
                log.debug("low_stock_scan.no_alerts")
                return

            svc = NotificationService(db)
            out_count = sum(1 for a in alerts if a.category == StockCategory.OUT_OF_STOCK)
            low_count = sum(1 for a in alerts if a.category == StockCategory.LOW)

            title = _low_stock_title(out_count, low_count)
            body = _low_stock_body(alerts[:10])
            severity = (
                NotificationSeverity.CRITICAL if out_count > 0
                else NotificationSeverity.WARNING
            )

            # Fire the two kinds separately so rules can subscribe to just one.
            if out_count:
                await svc.evaluate_kind(
                    NotificationKind.OUT_OF_STOCK,
                    title=title,
                    body=body,
                    severity=NotificationSeverity.CRITICAL,
                    metadata={"out_of_stock_count": out_count, "low_count": low_count},
                )
            if low_count:
                await svc.evaluate_kind(
                    NotificationKind.LOW_STOCK,
                    title=title,
                    body=body,
                    severity=severity,
                    metadata={"low_count": low_count, "out_of_stock_count": out_count},
                )
            log.info("low_stock_scan.done", out=out_count, low=low_count)
    except Exception:  # noqa: BLE001
        log.exception("low_stock_scan.failed")


async def day_close_reminder() -> None:
    """Nudge cashiers with a still-open session late in the day."""
    try:
        from sqlalchemy import select

        from app.db.models.day_session import DaySession, DayStatus
        from app.db.models.store import Store

        async with session_scope() as db:
            # Very light heuristic — anything opened before today's 22:00 local server hour
            # that's still OPEN gets a nudge.
            now = datetime.now(timezone.utc)
            if now.hour < 22:
                log.debug("day_close_reminder.too_early", hour=now.hour)
                return

            rows = (
                await db.scalars(
                    select(DaySession).where(DaySession.status == DayStatus.OPEN)
                )
            ).all()
            if not rows:
                log.debug("day_close_reminder.no_open_sessions")
                return

            svc = NotificationService(db)
            for session in rows:
                store = await db.get(Store, session.store_id)
                await svc.evaluate_kind(
                    NotificationKind.PENDING_DAY_CLOSE,
                    title=f"Day session still open — {store.code if store else 'unknown store'}",
                    body=(
                        f"The session opened at {session.opened_at.isoformat()} is still "
                        "OPEN. Close it to reconcile cash for the day."
                    ),
                    severity=NotificationSeverity.WARNING,
                    metadata={
                        "session_id": str(session.id),
                        "store_id": str(session.store_id),
                    },
                )
            log.info("day_close_reminder.done", sessions=len(rows))
    except Exception:  # noqa: BLE001
        log.exception("day_close_reminder.failed")


def _low_stock_title(out_count: int, low_count: int) -> str:
    if out_count and low_count:
        return f"{out_count} SKU(s) out of stock, {low_count} running low"
    if out_count:
        return f"{out_count} SKU(s) out of stock"
    return f"{low_count} SKU(s) running low"


def _low_stock_body(alerts) -> str:
    lines = [
        f"• {a.product_name} ({a.sku}) @ {a.store_code}: on hand {a.quantity}"
        + (
            f", suggested buy {a.suggested_reorder_qty}"
            if a.suggested_reorder_qty else ""
        )
        for a in alerts
    ]
    tail = "" if len(alerts) < 10 else "\n… and more; check Inventory health for the full list."
    return "\n".join(lines) + tail
