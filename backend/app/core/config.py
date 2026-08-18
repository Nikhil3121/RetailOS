"""Typed application settings loaded once from environment / .env.

All configuration flows through :class:`Settings`. Nothing else in the codebase reads
`os.environ` directly. The instance is memoised via :func:`get_settings` so it is safe
to inject as a FastAPI dependency without re-parsing on every request.
"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache
from typing import Annotated

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Environment(str, Enum):
    development = "development"
    staging = "staging"
    production = "production"


class Settings(BaseSettings):
    """Runtime settings resolved from environment variables.

    Field names are lowercased env vars; ``model_config`` makes matching case-insensitive
    and lets `.env` populate any missing values during local development.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # -- Runtime -------------------------------------------------------------
    environment: Environment = Environment.development
    debug: bool = True
    log_level: str = "INFO"
    api_v1_prefix: str = "/api/v1"
    project_name: str = "RetailOS"

    # -- Server --------------------------------------------------------------
    host: str = "127.0.0.1"
    port: int = 8000

    # -- Database ------------------------------------------------------------
    database_url: str = "postgresql+asyncpg://retailos:retailos@localhost:5432/retailos"
    database_echo: bool = False
    database_pool_size: int = 10
    database_max_overflow: int = 20

    @field_validator("database_url", mode="before")
    @classmethod
    def _coerce_database_url(cls, v: object) -> object:
        """Managed Postgres providers (Render, Heroku, Neon, Supabase) hand out
        ``postgres://`` URLs. SQLAlchemy 2 requires ``postgresql://`` — and our
        async engine needs the ``+asyncpg`` driver. Coerce both so the operator
        can paste the provider's URL verbatim into DATABASE_URL."""
        if not isinstance(v, str) or not v:
            return v
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://") and "+asyncpg" not in v:
            v = "postgresql+asyncpg://" + v[len("postgresql://"):]
        return v

    # -- Redis ---------------------------------------------------------------
    redis_url: str = "redis://localhost:6379/0"

    # -- Security ------------------------------------------------------------
    secret_key: SecretStr = SecretStr("change-me")
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 14
    jwt_algorithm: str = "HS256"

    # -- CORS ----------------------------------------------------------------
    # NoDecode tells pydantic-settings NOT to JSON-parse this before our validator
    # runs — otherwise a plain comma-separated env value would be rejected on load.
    cors_origins: Annotated[list[str], NoDecode, Field(default_factory=list)]

    # -- Rate limiting -------------------------------------------------------
    rate_limit_default: str = "200/minute"

    # -- Background scheduler ----------------------------------------------
    scheduler_enabled: bool = True
    scheduler_low_stock_interval_minutes: int = 15
    scheduler_day_close_interval_minutes: int = 60

    # -- Email dispatch -----------------------------------------------------
    # If any SMTP field is unset, the email dispatcher falls back to logging
    # the message instead of sending — safe default for pilots.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_use_tls: bool = True
    smtp_from_email: str | None = None
    smtp_from_name: str = "RetailOS"

    # ------------------------------------------------------------------
    # Validators & derived helpers
    # ------------------------------------------------------------------
    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors(cls, v: str | list[str]) -> list[str]:
        """Accept either a JSON array or a comma-separated string in the env file."""
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return []
            if v.startswith("["):
                # Delegate JSON list parsing to pydantic's default path
                return v  # type: ignore[return-value]
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @property
    def database_url_sync_form(self) -> str:
        """Sync-style DSN for tools (e.g. Alembic offline mode) that dislike asyncpg."""
        return self.database_url.replace("+asyncpg", "").replace("+aiosqlite", "")

    @property
    def is_production(self) -> bool:
        return self.environment is Environment.production


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()  # type: ignore[call-arg]
