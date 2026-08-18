"""HTTP middleware used app-wide.

- :class:`RequestContextMiddleware` — attaches a request id + timing to every log line
  emitted while a request is being handled, and echoes it in the ``X-Request-ID``
  response header so support tickets can quote a traceable id.
- :class:`SecurityHeadersMiddleware` — sets the security response headers OWASP
  recommends for every API response (HSTS, X-Content-Type-Options, etc.).
- :class:`StripTrailingSlashMiddleware` — rewrites `.../foo/` to `.../foo` before
  routing so both forms hit the same handler with no 307 redirect.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Receive, Scope, Send

_CONTEXT_HEADER = "X-Request-ID"


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Bind request id + duration to the structlog context for the life of the request."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = request.headers.get(_CONTEXT_HEADER, str(uuid.uuid4()))
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )

        start = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            structlog.contextvars.bind_contextvars(duration_ms=duration_ms)

        response.headers[_CONTEXT_HEADER] = request_id
        return response


class StripTrailingSlashMiddleware:
    """Rewrite `/foo/` to `/foo` in the ASGI scope before routing.

    Every endpoint in the app is registered without a trailing slash, and
    FastAPI's default behaviour is to answer `/foo/` with a `307 Temporary
    Redirect` to `/foo`. Under a cross-origin fetch that redirect drops the
    `Authorization` header on some browsers, and any stale Chromium/Electron
    cache that still remembers a slashed URL therefore ends up in a retry
    loop against an unauthenticated endpoint. Rewriting internally makes
    both forms hit the same handler with no redirect — the *right* URL keeps
    working exactly as before.

    Root paths (`/`), OpenAPI (`/docs/`, `/redoc/`, `/openapi.json`) and any
    path that is *just* slashes are left alone.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            path = scope.get("path") or ""
            if len(path) > 1 and path.endswith("/") and path.rstrip("/") != "":
                new_path = path.rstrip("/")
                # Mutate a copy — Starlette's scope is a plain dict but reused
                # across the request lifecycle.
                scope = dict(scope)
                scope["path"] = new_path
                raw_path = scope.get("raw_path")
                if isinstance(raw_path, (bytes, bytearray)):
                    # raw_path may contain a query string appended after `?`.
                    if b"?" in raw_path:
                        head, _, tail = raw_path.partition(b"?")
                        scope["raw_path"] = head.rstrip(b"/") + b"?" + tail
                    else:
                        scope["raw_path"] = raw_path.rstrip(b"/")
        await self.app(scope, receive, send)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Set the response headers OWASP recommends for defense-in-depth."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        headers = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "no-referrer")
        headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        # HSTS only applies over TLS — safe to always set; browsers ignore it on http://.
        headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response
