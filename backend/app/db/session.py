"""Async engine + session factory + request-scoped dependency.

One engine per process, one session per request. Sessions are always closed and the
context manager rolls back on exception, so services never have to remember to.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings, get_settings


def _build_engine(settings: Settings) -> AsyncEngine:
    """Construct the engine with pool/echo settings appropriate for the environment."""
    return create_async_engine(
        settings.database_url,
        echo=settings.database_echo,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_pre_ping=True,          # transparently drop stale connections
        future=True,
    )


_settings = get_settings()
engine: AsyncEngine = _build_engine(_settings)

# expire_on_commit=False lets caller code inspect ORM objects after commit,
# which is expected behavior in async request handlers.
SessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Context-managed session with commit-on-success, rollback-on-error semantics.

    Prefer :func:`app.api.deps.get_db` inside FastAPI endpoints (which delegates here).
    Use this directly from CLI scripts, background jobs, or tests.
    """
    session = SessionLocal()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()
