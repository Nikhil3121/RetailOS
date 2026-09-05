"""FastAPI dependency callables.

These are the *only* things endpoint signatures should reach for when they need
a DB session, the settings singleton, or the current user. Keeping the list
narrow makes the dependency graph obvious and testable.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Callable
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.exceptions import AuthenticationError, AuthorizationError
from app.core.security import TokenType, decode_token
from app.db.models.user import User, UserRole
from app.db.session import SessionLocal

# `auto_error=False` so we can raise our own AppError instead of FastAPI's default 403.
_bearer_scheme = HTTPBearer(auto_error=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    """Yield a request-scoped async session with commit-on-success semantics."""
    session = SessionLocal()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


DbSession = Annotated[AsyncSession, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


async def get_current_user(
    db: DbSession,
    _request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
) -> User:
    """Resolve the caller's User from the bearer JWT. Raises 401 if missing / invalid."""
    if credentials is None or not credentials.credentials:
        raise AuthenticationError("Missing bearer token.", code="AUTHENTICATION_REQUIRED")

    payload = decode_token(credentials.credentials, expected_type=TokenType.ACCESS)
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise AuthenticationError("Malformed token subject.", code="INVALID_TOKEN") from exc

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise AuthenticationError("Account disabled or removed.", code="ACCOUNT_DISABLED")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


#: Header carrying the elevation token from `POST /auth/verify-password`.
#:
#: A header rather than a body field so the same guard works on DELETE routes,
#: which have no body to put it in.
ELEVATION_HEADER = "X-Elevation-Token"


async def require_elevation(request: Request, user: CurrentUser) -> User:
    """Demand that the caller re-entered their password moments ago.

    This is the SERVER half of the confirm-with-password dialog. A prompt drawn
    only in the renderer stops nobody: the endpoint is reachable directly, and
    an unattended till with a logged-in session is exactly the situation the
    shop wanted protected. So the check lives here, where it cannot be skipped.

    Two conditions, both required:
      * a valid, unexpired elevation token, and
      * that token naming THE SAME user as the access token.

    The second is what stops a manager's five-minute window being borrowed by
    whoever sits down at the terminal next.
    """
    raw = request.headers.get(ELEVATION_HEADER)
    if not raw:
        raise AuthenticationError(
            "Confirm your password to continue.",
            code="ELEVATION_REQUIRED",
        )

    payload = decode_token(raw, expected_type=TokenType.ELEVATION)
    if str(payload.get("sub")) != str(user.id):
        raise AuthenticationError(
            "Confirm your password to continue.",
            code="ELEVATION_MISMATCH",
        )
    return user


def require_role(*allowed: UserRole) -> Callable[[User], User]:
    """Route-level guard: only users with one of `allowed` roles may proceed.

    Usage:
        @router.post("/", dependencies=[Depends(require_role(UserRole.OWNER, UserRole.SUPER_ADMIN))])
    """
    allowed_set = set(allowed)

    def _dep(user: CurrentUser) -> User:
        if user.role not in allowed_set:
            raise AuthorizationError(
                "You do not have permission to perform this action.",
                code="INSUFFICIENT_ROLE",
                details={"required": sorted(r.value for r in allowed_set), "actual": user.role.value},
            )
        return user

    return _dep


def require_min_role(minimum: UserRole) -> Callable[[User], User]:
    """Route-level guard using the role priority ladder (roles ≥ `minimum` allowed)."""
    min_priority = minimum.priority()

    def _dep(user: CurrentUser) -> User:
        if user.role.priority() < min_priority:
            raise AuthorizationError(
                "You do not have permission to perform this action.",
                code="INSUFFICIENT_ROLE",
                details={"minimum": minimum.value, "actual": user.role.value},
            )
        return user

    return _dep
