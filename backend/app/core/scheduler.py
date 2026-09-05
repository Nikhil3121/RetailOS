"""APScheduler bootstrap. Started + shut down from the FastAPI lifespan hook."""

from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.scheduled_jobs import (
    day_close_reminder,
    low_stock_scan,
    loyalty_expiry_sweep,
)

log = get_logger("scheduler")

_scheduler: AsyncIOScheduler | None = None


def start_scheduler() -> None:
    """Idempotent — safe to call multiple times."""
    global _scheduler
    if _scheduler is not None:
        return
    settings = get_settings()
    if not settings.scheduler_enabled:
        log.info("scheduler.disabled")
        return

    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(
        low_stock_scan,
        trigger=IntervalTrigger(minutes=settings.scheduler_low_stock_interval_minutes),
        id="low_stock_scan",
        name="Low stock scan",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        day_close_reminder,
        trigger=IntervalTrigger(minutes=settings.scheduler_day_close_interval_minutes),
        id="day_close_reminder",
        name="Day close reminder",
        max_instances=1,
        coalesce=True,
    )
    # Daily. Expiry is a change to what the shop owes its customers, so it
    # happens on a predictable schedule rather than whenever a screen is opened.
    scheduler.add_job(
        loyalty_expiry_sweep,
        trigger=IntervalTrigger(hours=24),
        id="loyalty_expiry_sweep",
        name="Loyalty points expiry",
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    _scheduler = scheduler
    log.info(
        "scheduler.started",
        low_stock_every_min=settings.scheduler_low_stock_interval_minutes,
        day_close_every_min=settings.scheduler_day_close_interval_minutes,
    )


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        log.info("scheduler.stopped")
