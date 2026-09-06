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
from sqlalchemy import event  # noqa: E402
from sqlalchemy.engine import Engine  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

import app.db.session as db_session_mod  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.db.base import Base  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _disable_rate_limiting() -> None:
    """Turn off slowapi for the suite.

    Limits are keyed by client IP and every test shares one, so the 5/min
    ceiling on /auth/login trips after a few logins and fails unrelated
    tests with 429. The limits themselves are covered separately against
    a live deployment.
    """
    from app.core.rate_limit import limiter

    limiter.enabled = False


# SQLite ships with foreign keys OFF and nothing here turned them on, so every
# `ondelete=` in the schema went untested while production PostgreSQL enforced
# all of them. The two databases disagreed precisely on what happens when a row
# is deleted — deleting a staff member SET NULLs their sales attribution and
# CASCADE-deletes their commission rules in PostgreSQL, and did nothing at all
# in the tests.
#
# Registered on Engine GLOBALLY rather than on the engine built below, because
# there are two engines against the same file. `app/api/deps.py` binds
# `SessionLocal` with a from-import at module load, so every API REQUEST runs on
# the engine created when the app was imported — not on the one this fixture
# swaps in. A listener attached only to the replacement covered `session_scope()`
# and missed the entire request path, which is most of the suite.
@event.listens_for(Engine, "connect")
def _sqlite_enforce_foreign_keys(dbapi_connection, _record) -> None:  # noqa: ANN001
    # Attempted unconditionally: conftest forces DATABASE_URL to SQLite, so
    # every engine in the suite is SQLite. Sniffing the connection class does
    # not work — aiosqlite arrives wrapped in a SQLAlchemy adapter, so a naive
    # module check silently skips exactly the connections that need it.
    try:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
    except Exception:  # noqa: BLE001 — a non-SQLite engine simply has no pragma
        pass


@pytest.fixture(scope="session", autouse=True)
def _override_engine() -> AsyncIterator[None]:
    """Rebuild the engine against SQLite once per test session."""
    get_settings.cache_clear()
    settings = get_settings()

    # NullPool: every connection is opened fresh and closed after use.
    #
    # `PRAGMA foreign_keys` is PER CONNECTION, so with a shared pool one test
    # can hand back a connection with it unset and the next test runs
    # unenforced. That is decided by which connection a test happens to draw,
    # which is why it looked like a test passing alone and failing in the
    # suite. The sync tests in test_production_guards.py made it reproducible:
    # their async autouse fixture runs in its own event loop, so the connection
    # it touches goes back to the pool in a state the next test inherits.
    #
    # A throwaway SQLite file does not need connection pooling; determinism
    # here is worth far more than the microseconds.
    engine = create_async_engine(
        settings.database_url, future=True, poolclass=NullPool
    )

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
    """Drop + recreate every table before each test — full isolation, no fixtures needed.

    Foreign keys are switched OFF for the rebuild and back ON for the test.

    `drop_all` does not order tables by dependency in a way SQLite's enforcement
    accepts, so with FKs on the teardown itself fails — which is the only reason
    they were never enabled. Enforcement during the TEST is what matters; the
    order in which a throwaway schema is torn down does not.

    AUTOCOMMIT is load-bearing: `PRAGMA foreign_keys` is a NO-OP inside a
    transaction, so under `engine.begin()` the OFF would never apply and the
    rebuild would fail on the constraints it is meant to sidestep. The engine
    uses NullPool, so this connection is discarded rather than handed on.
    """
    async with db_session_mod.engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        await conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    from app.main import create_app

    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac
