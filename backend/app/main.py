"""FastAPI application factory.

The factory pattern lets tests build isolated app instances with overridden
dependencies. The module-level ``app`` at the bottom is what ``uvicorn app.main:app``
imports for the dev server.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app import __version__
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.middleware import (
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
    StripTrailingSlashMiddleware,
)
from app.core.rate_limit import limiter
from app.core.scheduler import shutdown_scheduler, start_scheduler
from app.db.session import SessionLocal
from app.services.seed import seed_default_expense_categories


#: Values that must never sign a real token. `change-me` is the shipped default
#: in `config.py`, so it is in the public repository and known to everyone.
_UNSAFE_SIGNING_KEYS = {"change-me", "changeme", "secret", "test", "dev", ""}

#: Substrings that mark a key as copied rather than generated.
#:
#: A length check alone is not enough: `.env.example` ships
#: "change-me-in-real-deployments-please-generate-a-64-byte-urlsafe-token",
#: which is 68 characters and would sail past any minimum. It is also the single
#: most likely value to reach production, because copying `.env.example` to
#: `.env` is exactly what a deployer does first.
_PLACEHOLDER_MARKERS = ("change", "example", "placeholder", "your-", "xxx", "generate-a-")

#: 32 characters ≈ 192 bits at base64 density. Comfortably past brute force,
#: and what `openssl rand -hex 32` produces without anyone having to think.
_MIN_SIGNING_KEY_LENGTH = 32


def _assert_signing_key_is_safe(settings) -> None:  # noqa: ANN001 — Settings, avoiding a cycle
    """Refuse to start a production server whose JWTs anyone could forge.

    `SECRET_KEY` signs every access token. Booting production with the default
    is not a weak configuration, it is NO AUTHENTICATION: anyone who has read
    this repository can mint a token for any user id and call any endpoint as
    the owner. Nothing else in the system detects that, because the forged token
    is cryptographically valid.

    This is the one setting worth refusing to boot over. A shop whose server
    will not start phones for help within minutes; a shop whose server started
    with a public signing key finds out much later and much worse. Every other
    misconfiguration here degrades safely and only warns.

    Development and test are left alone so the default keeps `docker compose up`
    and the test suite working with no setup.
    """
    if not settings.is_production:
        return

    key = settings.secret_key.get_secret_value()
    normalised = key.strip().lower()

    if normalised in _UNSAFE_SIGNING_KEYS or any(
        marker in normalised for marker in _PLACEHOLDER_MARKERS
    ):
        raise RuntimeError(
            "SECRET_KEY still looks like a placeholder in a production "
            "environment. Every authentication token would be forgeable by "
            "anyone who has seen this repository. "
            "Set SECRET_KEY to a real random secret, e.g. `openssl rand -hex 32`."
        )
    if len(key) < _MIN_SIGNING_KEY_LENGTH:
        raise RuntimeError(
            f"SECRET_KEY is only {len(key)} characters. Use at least "
            f"{_MIN_SIGNING_KEY_LENGTH}, e.g. `openssl rand -hex 32`."
        )


def create_app() -> FastAPI:
    """Build and wire the FastAPI application."""
    settings = get_settings()
    configure_logging(settings)
    log = get_logger(__name__)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        log.info(
            "startup",
            environment=settings.environment.value,
            debug=settings.debug,
            version=__version__,
        )
        start_scheduler()
        # Idempotent one-shot seeding — ensures common defaults exist so the
        # UI works out-of-the-box (e.g. Expenses needs at least one category).
        try:
            async with SessionLocal() as db:
                await seed_default_expense_categories(db)
        except Exception:
            log.exception("seed_failed")
        try:
            yield
        finally:
            shutdown_scheduler()
            log.info("shutdown")

    app = FastAPI(
        title=settings.project_name,
        version=__version__,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
        openapi_url="/openapi.json" if not settings.is_production else None,
        lifespan=lifespan,
        # We handle trailing slashes ourselves via StripTrailingSlashMiddleware
        # below, so FastAPI's default 307-redirect-to-canonical is turned off.
        # Cross-origin 307s were dropping the Authorization header in Chromium
        # and causing a retry loop on `/auth/me/`.
        redirect_slashes=False,
    )

    # A production deployment must never sign tokens with a key anyone can read.
    _assert_signing_key_is_safe(settings)

    # -- Middleware (added in reverse execution order) ----------------------
    # CORS — a permissive `*` on a real deployment lets any site drive an
    # authenticated request from a victim's browser (CSRF-style).
    #
    # This WARNS rather than refusing, deliberately: browsers already reject
    # `*` combined with credentials, so the practical blast radius is small,
    # and hard-failing here would take a running shop offline over a setting
    # that degrades safely. The signing key above is the opposite case — a
    # known key is silently exploitable — so that one does refuse.
    if settings.cors_origins:
        if settings.is_production and "*" in settings.cors_origins:
            log.warning(
                "cors_wildcard_in_production",
                message=(
                    "CORS_ORIGINS contains '*' in a production environment. "
                    "Set CORS_ORIGINS to an explicit comma-separated whitelist."
                ),
            )
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["X-Request-ID"],
        )

    if settings.is_production:
        # In prod we don't want the app answering to arbitrary Host headers —
        # blocks Host-header injection + basic scanner traffic. Whitelist reads
        # from ALLOWED_HOSTS env var (comma-separated); falls back to '*' only
        # when unset so an env-var-less redeploy doesn't 400 every request.
        allowed = settings.allowed_hosts if settings.allowed_hosts else ["*"]
        if allowed == ["*"]:
            log.warning(
                "trusted_host_wildcard_in_production",
                message="ALLOWED_HOSTS is not set — TrustedHost accepting any Host header.",
            )
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed)

    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)
    # Must be added last so it runs FIRST (Starlette applies middleware in
    # reverse order). The path rewrite has to happen before routing.
    app.add_middleware(StripTrailingSlashMiddleware)

    # -- Rate limiting -------------------------------------------------------
    # `limiter` is defined in app.core.rate_limit — sharing it means the
    # 200/min default here and the per-endpoint 5/min limits on /auth/login
    # use the SAME storage backend (in-memory today, redis when we scale).
    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)

    @app.exception_handler(RateLimitExceeded)
    async def _rate_limit_handler(_, exc: RateLimitExceeded) -> JSONResponse:
        return JSONResponse(
            status_code=429,
            content={
                "error": {
                    "code": "RATE_LIMITED",
                    "message": f"Rate limit exceeded: {exc.detail}",
                    "details": {},
                }
            },
        )

    # -- Exception handlers --------------------------------------------------
    register_exception_handlers(app)

    # -- Routes --------------------------------------------------------------
    app.include_router(api_router, prefix=settings.api_v1_prefix)

    return app


app = create_app()
