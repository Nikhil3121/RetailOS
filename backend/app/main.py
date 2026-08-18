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
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
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
from app.core.scheduler import shutdown_scheduler, start_scheduler
from app.db.session import SessionLocal
from app.services.seed import seed_default_expense_categories


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

    # -- Middleware (added in reverse execution order) ----------------------
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["X-Request-ID"],
        )

    if settings.is_production:
        # In prod we don't want the app answering to arbitrary Host headers.
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=["*"])  # tighten in Phase 4

    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)
    # Must be added last so it runs FIRST (Starlette applies middleware in
    # reverse order). The path rewrite has to happen before routing.
    app.add_middleware(StripTrailingSlashMiddleware)

    # -- Rate limiting -------------------------------------------------------
    limiter = Limiter(key_func=get_remote_address, default_limits=[settings.rate_limit_default])
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
