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
