"""Authentication use cases.

The service owns *all* rules around who can log in, when tokens rotate, and when
credentials are revoked. Endpoints below it are transport; everything below it
(the repository / DB layer) is dumb persistence.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import AuthenticationError, NotFoundError, ValidationError
from app.core.security import (
    TokenType,
    create_2fa_challenge_token,
    create_access_token,
    create_password_reset_token,
    decode_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    password_needs_rehash,
    verify_password,
)
from app.db.models.user import RefreshToken, User
from app.schemas.auth import TokenPair


class AuthService:
    """All authentication flows. Instantiated per-request with an active session."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.settings = get_settings()

    # ------------------------------------------------------------------
    # Login
    # ------------------------------------------------------------------
    async def authenticate(self, *, email: str, password: str) -> User:
        """Return the User if credentials check out, else raise AuthenticationError."""
        user = await self._get_user_by_email(email)
        if user is None or not user.is_active:
            # Same error either way — never leak which of the two failed.
            raise AuthenticationError("Invalid email or password.", code="INVALID_CREDENTIALS")

        if not verify_password(password, user.hashed_password):
            raise AuthenticationError("Invalid email or password.", code="INVALID_CREDENTIALS")

        # Opportunistic rehash if the argon2 parameters have moved on since last login.
        if password_needs_rehash(user.hashed_password):
            user.hashed_password = hash_password(password)

        user.last_login_at = datetime.now(timezone.utc)
        await self.db.flush()
        return user

    def issue_2fa_challenge(self, user: User) -> str:
        """Short-lived token that carries the user id into the /login/2fa step."""
        return create_2fa_challenge_token(subject=str(user.id))

    async def resolve_2fa_challenge(self, challenge_token: str) -> User:
        """Decode a challenge token and return the (still-active) user."""
        payload = decode_token(challenge_token, expected_type=TokenType.CHALLENGE)
        user = await self.db.get(User, uuid.UUID(payload["sub"]))
        if user is None or not user.is_active:
            raise AuthenticationError(
                "Account disabled.", code="ACCOUNT_DISABLED"
            )
        return user

    # --- Login OTP (email) --------------------------------------------------
    #
    # Distinct from 2FA/TOTP: the OTP is delivered by the server (email) once
    # per login, not generated on the user's phone. Both cannot fire on the
    # same login — TOTP wins if a user has it enrolled.

    def issue_login_otp(self, user: User) -> tuple[str, int]:
        """Generate + deliver a fresh OTP; return (challenge_token, expires_in_seconds).

        Kept as an instance method (not a free function) so the endpoint layer
        stays uniform — one service, one entry point per flow.
        """
        # Local import — the OTP service imports from security.py, and we
        # want to keep the top-of-file import block focused on the always-
        # loaded auth primitives.
        from app.services.login_otp import LoginOtpService

        return LoginOtpService().issue(user)

    async def resolve_login_otp(self, *, challenge_token: str, code: str) -> User:
        """Verify an OTP challenge and return the (still-active) user."""
        from app.services.login_otp import LoginOtpService

        subject = LoginOtpService().verify(challenge_token=challenge_token, code=code)
        user = await self.db.get(User, uuid.UUID(subject))
        if user is None or not user.is_active:
            raise AuthenticationError("Account disabled.", code="ACCOUNT_DISABLED")
        return user

    async def issue_token_pair(self, user: User) -> TokenPair:
        """Mint fresh access + refresh tokens for `user` and persist the refresh record."""
        access = create_access_token(
            subject=str(user.id),
            extra={"role": user.role.value, "store_id": str(user.store_id) if user.store_id else None},
        )
        refresh_plain = generate_refresh_token()
        await self._store_refresh_token(user_id=user.id, token_plain=refresh_plain)

        return TokenPair(
            access_token=access,
            refresh_token=refresh_plain,
            expires_in=self.settings.access_token_expire_minutes * 60,
        )

    # ------------------------------------------------------------------
    # Refresh & logout
    # ------------------------------------------------------------------
    async def refresh(self, *, refresh_token: str) -> TokenPair:
        """Rotate a refresh token: revoke the presented one, issue a new pair."""
        existing = await self._lookup_active_refresh(refresh_token)
        user = await self.db.get(User, existing.user_id)
        if user is None or not user.is_active:
            existing.revoked_at = datetime.now(timezone.utc)
            raise AuthenticationError("Account disabled.", code="ACCOUNT_DISABLED")

        new_pair = await self.issue_token_pair(user)
        # Mark the old token as replaced (rotation).
        existing.revoked_at = datetime.now(timezone.utc)
        new_hash = hash_refresh_token(new_pair.refresh_token)
        new_row = await self.db.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == new_hash)
        )
        if new_row is not None:
            existing.replaced_by_id = new_row.id
        return new_pair

    async def logout(self, *, refresh_token: str) -> None:
        """Revoke a single refresh token. Idempotent — no error if already revoked."""
        token_hash = hash_refresh_token(refresh_token)
        row = await self.db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        if row is not None and row.revoked_at is None:
            row.revoked_at = datetime.now(timezone.utc)

    async def revoke_all(self, *, user_id: uuid.UUID) -> None:
        """Revoke every active session for a user (used on password change)."""
        rows = (
            await self.db.scalars(
                select(RefreshToken).where(
                    RefreshToken.user_id == user_id,
                    RefreshToken.revoked_at.is_(None),
                )
            )
        ).all()
        now = datetime.now(timezone.utc)
        for row in rows:
            row.revoked_at = now

    # ------------------------------------------------------------------
    # Password management
    # ------------------------------------------------------------------
    async def change_password(
        self,
        *,
        user: User,
        current_password: str,
        new_password: str,
    ) -> None:
        if not verify_password(current_password, user.hashed_password):
            raise AuthenticationError("Current password is incorrect.", code="INVALID_CREDENTIALS")
        if current_password == new_password:
            raise ValidationError("New password must differ from the current one.")
        user.hashed_password = hash_password(new_password)
        await self.revoke_all(user_id=user.id)

    async def request_password_reset(self, *, email: str) -> str | None:
        """Return a reset token if the user exists, else None. Never raises for unknown users."""
        user = await self._get_user_by_email(email)
        if user is None or not user.is_active:
            return None
        return create_password_reset_token(subject=str(user.id))

    async def reset_password(self, *, reset_token: str, new_password: str) -> None:
        payload = decode_token(reset_token, expected_type=TokenType.RESET)
        user_id = uuid.UUID(payload["sub"])
        user = await self.db.get(User, user_id)
        if user is None or not user.is_active:
            raise NotFoundError("User not found.", code="USER_NOT_FOUND")
        user.hashed_password = hash_password(new_password)
        await self.revoke_all(user_id=user.id)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    async def _get_user_by_email(self, email: str) -> User | None:
        stmt = select(User).where(User.email == email.lower())
        return await self.db.scalar(stmt)

    async def _store_refresh_token(self, *, user_id: uuid.UUID, token_plain: str) -> None:
        expires_at = datetime.now(timezone.utc) + timedelta(
            days=self.settings.refresh_token_expire_days
        )
        row = RefreshToken(
            user_id=user_id,
            token_hash=hash_refresh_token(token_plain),
            expires_at=expires_at,
        )
        self.db.add(row)
        await self.db.flush()

    async def _lookup_active_refresh(self, token_plain: str) -> RefreshToken:
        token_hash = hash_refresh_token(token_plain)
        row = await self.db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        if row is None:
            raise AuthenticationError("Invalid refresh token.", code="INVALID_TOKEN")
        if row.revoked_at is not None:
            raise AuthenticationError("Refresh token has been revoked.", code="TOKEN_REVOKED")
        if row.expires_at <= datetime.now(timezone.utc):
            raise AuthenticationError("Refresh token has expired.", code="TOKEN_EXPIRED")
        return row
