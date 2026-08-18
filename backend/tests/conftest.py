"""Shared pytest fixtures.

Tests run against an isolated per-session SQLite database (via aiosqlite) so
the suite has no Docker dependency. Alembic migrations are Postgres-flavoured;
tests use ``Base.metadata.create_all`` instead, which yields the same schema
because the models rely only on `sa.Uuid` and other portable types.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest

# ---- Override configuration BEFORE the app imports it -----------------------
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./_test_retailos.db")
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key-not-for-production-use-only")
os.environ.setdefault("CORS_ORIGINS", "")

from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

import app.db.session as db_session_mod  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.db.base import Base  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _override_engine() -> AsyncIterator[None]:
    """Rebuild the engine against SQLite once per test session."""
    get_settings.cache_clear()
    settings = get_settings()

    engine = create_async_engine(settings.database_url, future=True)
    session_local = async_sessionmaker(
        bind=engine, expire_on_commit=False, autoflush=False,
    )
    db_session_mod.engine = engine
    db_session_mod.SessionLocal = session_local

    yield

    import asyncio

    asyncio.run(engine.dispose())


@pytest.fixture(autouse=True)
async def _clean_db() -> AsyncIterator[None]:
    """Drop + recreate every table before each test — full isolation, no fixtures needed."""
    async with db_session_mod.engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    from app.main import create_app

    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac
