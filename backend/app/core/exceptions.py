"""Domain-level exception hierarchy + FastAPI translation layer.

Business code raises :class:`AppError` subclasses. HTTP concerns stay out of services.
:func:`register_exception_handlers` maps them to a uniform JSON envelope at the API edge:

    { "error": { "code": "STORE_NOT_FOUND", "message": "…", "details": {...} } }

Front-end code always receives that same shape, regardless of which layer raised.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger

log = get_logger(__name__)


def _jsonable_errors(errors: list[dict]) -> list[dict]:
    """Make Pydantic's error list safe to serialise.

    A `model_validator` that raises ValueError puts the EXCEPTION OBJECT into
    the error's `ctx`, and json.dumps cannot serialise it. The handler then
    died mid-response, so every such rule returned 500 INSTEAD OF 422 — the
    validation fired correctly and the caller was told the server had crashed.

    This affected any custom validator anywhere in the app, and stayed hidden
    because until now none of them raised.

    `input` is dropped rather than stringified: it is the caller's own payload
    echoed back, and for `/auth` routes that means a password in the response
    body and in whatever logs it.
    """
    safe: list[dict] = []
    for err in errors:
        clean = {k: v for k, v in err.items() if k not in {"ctx", "input", "url"}}
        ctx = err.get("ctx")
        if isinstance(ctx, dict):
            # Keep the context values that are plain data; drop the rest.
            keep = {
                k: v
                for k, v in ctx.items()
                if isinstance(v, (str, int, float, bool, type(None)))
            }
            if keep:
                clean["ctx"] = keep
        safe.append(clean)
    return safe


# ---------------------------------------------------------------------------
# Domain exceptions
# ---------------------------------------------------------------------------


class AppError(Exception):
    """Base class for every expected, user-visible error in the domain."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "APP_ERROR"

    def __init__(
        self,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        code: str | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "NOT_FOUND"


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "CONFLICT"


class ValidationError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "VALIDATION_ERROR"


class AuthenticationError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "AUTHENTICATION_REQUIRED"


class AuthorizationError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "FORBIDDEN"


class RateLimitedError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "RATE_LIMITED"


# ---------------------------------------------------------------------------
# Response envelope
# ---------------------------------------------------------------------------


def _envelope(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or {}}}


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


def register_exception_handlers(app: FastAPI) -> None:
    """Attach handlers translating exceptions to the standard error envelope."""

    @app.exception_handler(AppError)
    async def _handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        log.warning("app_error", code=exc.code, message=exc.message, details=exc.details)
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def _handle_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=_envelope(
                "VALIDATION_ERROR",
                "Request body failed validation.",
                {"errors": _jsonable_errors(exc.errors())},
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _handle_http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope("HTTP_ERROR", str(exc.detail)),
        )

    @app.exception_handler(Exception)
    async def _handle_uncaught(_: Request, exc: Exception) -> JSONResponse:
        # Do NOT leak internals in production.
        log.exception("unhandled_exception", exc_type=type(exc).__name__)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_envelope("INTERNAL_ERROR", "An unexpected error occurred."),
        )
