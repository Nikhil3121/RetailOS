"""Two-factor auth service — enrolment + verification for TOTP."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    AuthenticationError,
    ConflictError,
    NotFoundError,
    ValidationError,
)
from app.core.security import verify_password
from app.core.totp import generate_secret, provisioning_uri, totp_verify
from app.db.models.user import User


class TwoFactorService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def start_enrolment(self, user: User) -> tuple[str, str]:
        """Generate a fresh secret + provisioning URI.

        Overwrites any half-completed enrolment (`totp_enabled` still False),
        but refuses to trample an already-enabled configuration — the user
        must disable first if they want to re-enrol.
        """
        if user.totp_enabled:
            raise ConflictError(
                "Two-factor auth is already enabled — disable it before re-enrolling.",
                code="TOTP_ALREADY_ENABLED",
            )
        secret = generate_secret()
        user.totp_secret = secret
        user.totp_enabled = False
        await self.db.flush()
        return secret, provisioning_uri(secret, account=user.email)

    async def confirm_enrolment(self, user: User, code: str) -> None:
        """Verify the code against the pending secret and flip `totp_enabled` on."""
        if not user.totp_secret:
            raise ValidationError(
                "No pending 2FA setup — start enrolment first.",
                code="TOTP_NOT_STARTED",
            )
        if not totp_verify(user.totp_secret, code):
            raise AuthenticationError(
                "Code is incorrect or expired — try the next one shown in your app.",
                code="TOTP_INVALID",
            )
        user.totp_enabled = True
        await self.db.flush()

    async def disable(self, user: User, *, current_password: str, code: str) -> None:
        """Turn 2FA off — requires the current password AND a valid code so a
        stolen but authenticator-less session can't quietly disable it."""
        if not user.totp_enabled or not user.totp_secret:
            raise ValidationError(
                "Two-factor auth is not enabled on this account.",
                code="TOTP_NOT_ENABLED",
            )
        if not verify_password(current_password, user.hashed_password):
            raise AuthenticationError(
                "Current password is incorrect.", code="INVALID_CREDENTIALS"
            )
        if not totp_verify(user.totp_secret, code):
            raise AuthenticationError(
                "Code is incorrect or expired.", code="TOTP_INVALID"
            )
        user.totp_secret = None
        user.totp_enabled = False
        await self.db.flush()

    async def verify_code_for_user(self, user_id: uuid.UUID, code: str) -> User:
        """Look up the user and verify their current TOTP code. Raises on failure."""
        user = await self.db.get(User, user_id)
        if user is None or not user.is_active:
            raise NotFoundError("User not found.", code="USER_NOT_FOUND")
        if not user.totp_enabled or not user.totp_secret:
            raise ValidationError(
                "Two-factor auth is not enabled on this account.",
                code="TOTP_NOT_ENABLED",
            )
        if not totp_verify(user.totp_secret, code):
            raise AuthenticationError(
                "Code is incorrect or expired.", code="TOTP_INVALID"
            )
        return user
