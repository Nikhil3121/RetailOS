"""Alembic migration environment.

Loads the application's Settings and metadata so migrations always target the same
database the app talks to, and always see every model registered on `Base.metadata`.
Uses SQLAlchemy's async engine and Alembic's `run_sync` bridge — no separate sync DSN.
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import get_settings
from app.db.base import Base

# Importing this module ensures every model is registered on Base.metadata before
# autogenerate walks the metadata tree. It stays intentionally empty until real
# models land in later milestones.
from app.db import models  # noqa: F401

config = context.config

# Override the placeholder DSN with the real one from Settings.
settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.database_url_sync_form)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Emit SQL to stdout without a live DB connection (useful for review/CI)."""
    context.configure(
        url=settings.database_url_sync_form,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Open an async engine, hand a sync-view connection to Alembic, and run."""
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = settings.database_url

    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        future=True,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
