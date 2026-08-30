"""Phase 5C — fixtures that run the suite against REAL PostgreSQL.

WHY THIS EXISTS
---------------
tests/conftest.py runs on aiosqlite. That is fine for logic, but it cannot
prove what Phase 5C is about: whether the uq_sales_client_uuid constraint and
the IntegrityError recovery path behave correctly under genuine concurrent
writes with real MVCC. Only PostgreSQL can answer that.

SAFETY
------
The developer's own data lives in the `public` schema of the same database.
Two deliberate precautions keep it out of reach:

  1. Every table is created in an isolated `p5c_test` schema.
  2. search_path is set to `p5c_test` ALONE - not `p5c_test,public`.

The second matters more than it looks. `Base.metadata.drop_all()` runs before
every test; if `public` were on the search path, the very first run - when
p5c_test is still empty - would resolve those DROPs against the developer's
real tables. Excluding `public` makes that mistake impossible rather than
merely unlikely.

The connection target is also asserted to be localhost, so this can never be
pointed at the hosted database by an inherited environment variable.
"""

from __future__ import annotations

import os
import pathlib
import re
import urllib.parse as up
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio

TEST_SCHEMA = "p5c_test"


def _local_pg_url() -> str:
    """Build the async URL from the developer's .env, and refuse anything remote."""
    backend = pathlib.Path(__file__).resolve().parents[1]
    raw = (backend / ".env").read_text(encoding="utf-8", errors="replace")
    match = re.search(r"^DATABASE_URL=(.+)$", raw, re.M)
    if match is None:
        pytest.skip("No DATABASE_URL in backend/.env")

    url = match.group(1).strip().strip('"').strip("'")
    parsed = up.urlparse(re.sub(r"^postgresql\+\w+://", "postgresql://", url))

    if parsed.scheme != "postgresql":
        pytest.skip("DATABASE_URL is not PostgreSQL")
    # Hard stop: these tests write and drop tables. They must never reach a
    # hosted database, whatever the environment happens to be configured for.
    if parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        pytest.fail(
            f"Refusing to run destructive tests against non-local host "
            f"{parsed.hostname!r}."
        )

    return (
        f"postgresql+asyncpg://{parsed.username}:{up.quote(parsed.password or '')}"
        f"@{parsed.hostname}:{parsed.port or 5432}/{parsed.path.lstrip('/')}"
    )


PG_URL = _local_pg_url()

os.environ["DATABASE_URL"] = PG_URL
os.environ.setdefault("SECRET_KEY", "phase5c-secret-key-not-for-production-use-only")
os.environ.setdefault("CORS_ORIGINS", "")
# The developer's .env turns SQL echo on; it buries test output.
os.environ["DATABASE_ECHO"] = "false"

from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

import app.db.session as db_session_mod  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.db.base import Base  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _disable_rate_limiting() -> None:
    from app.core.rate_limit import limiter

    limiter.enabled = False


async def _reset_schema() -> None:
    """DROP and recreate the isolated schema using a throwaway connection.

    CASCADE also clears anything the metadata does not know about - stray
    tables from an interrupted run, sequences, enum types - so every test
    starts from genuinely nothing. Scoped to the test schema; `public`, where
    the developer's own data lives, is never named here.
    """
    import asyncpg

    parsed = up.urlparse(re.sub(r"^postgresql\+\w+://", "postgresql://", PG_URL))
    con = await asyncpg.connect(
        host=parsed.hostname,
        port=parsed.port,
        user=parsed.username,
        password=up.unquote(parsed.password or ""),
        database=parsed.path.lstrip("/"),
    )
    try:
        await con.execute(f"DROP SCHEMA IF EXISTS {TEST_SCHEMA} CASCADE")
        await con.execute(f"CREATE SCHEMA {TEST_SCHEMA}")
    finally:
        await con.close()


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def _engine_and_clean_db() -> AsyncIterator[None]:
    """Build the engine and a clean schema for EVERY test.

    Function-scoped on purpose. asyncpg binds its pooled connections to the
    event loop that created them, and pytest-asyncio gives each test its own
    loop - a session-scoped engine therefore hands the second test connections
    belonging to a loop that has already closed.

    The pool is sized for the concurrency tests: 50 simultaneous requests each
    need their own connection, and a smaller pool would quietly serialise them,
    turning the concurrency test into a sequential one that proves nothing.
    """
    get_settings.cache_clear()

    # Reset the schema on a RAW asyncpg connection, before the SQLAlchemy
    # engine exists. Doing it through the engine meant create_all ran on a
    # connection whose schema had just been dropped out from under it, and
    # the pooled connections kept a stale view of the catalog.
    await _reset_schema()

    engine = create_async_engine(
        PG_URL,
        future=True,
        pool_size=30,
        max_overflow=40,
        pool_pre_ping=True,
        connect_args={"server_settings": {"search_path": TEST_SCHEMA}},
    )
    db_session_mod.engine = engine
    db_session_mod.SessionLocal = async_sessionmaker(
        bind=engine, expire_on_commit=False, autoflush=False,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    await engine.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def client() -> AsyncIterator[AsyncClient]:
    from app.main import create_app

    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac
