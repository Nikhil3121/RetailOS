"""Security primitives: password hashing, JWT encode/decode, secret token generation.

Everything cryptographic lives here so the rest of the codebase never has to think
about algorithms. Consumers call named helpers and get an opaque `str` back.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext
# `hashlib` stays imported — it still backs `hash_refresh_token` below.

from app.core.config import get_settings
from app.core.exceptions import AuthenticationError

# argon2id — memory-hard, resistant to GPU/ASIC attacks, current OWASP recommendation.
_pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------


def hash_password(plain: str) -> str:
    """Return an argon2id hash of `plain` including the algorithm parameters."""
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Constant-time verify; returns False for any malformed hash."""
    try:
        return _pwd_context.verify(plain, hashed)
    except Exception:
        return False


def password_needs_rehash(hashed: str) -> bool:
    """True if the stored hash uses out-of-date parameters. Call after successful login."""
    return _pwd_context.needs_update(hashed)


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------


class TokenType(str, Enum):
    ACCESS = "access"
    RESET = "reset"
    CHALLENGE = "2fa_challenge"


def _encode(payload: dict[str, Any], expires_delta: timedelta, token_type: TokenType) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    to_encode = {
        **payload,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_delta).timestamp()),
        "type": token_type.value,
    }
    return jwt.encode(
        to_encode,
        settings.secret_key.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )


def create_access_token(*, subject: str, extra: dict[str, Any] | None = None) -> str:
    """Issue an access JWT for `subject` (typically the user id)."""
    settings = get_settings()
    payload: dict[str, Any] = {"sub": subject}
    if extra:
        payload.update(extra)
    return _encode(payload, timedelta(minutes=settings.access_token_expire_minutes), TokenType.ACCESS)


def create_password_reset_token(*, subject: str) -> str:
    """Issue a short-lived (15 min) password-reset JWT."""
    return _encode({"sub": subject}, timedelta(minutes=15), TokenType.RESET)


def create_2fa_challenge_token(*, subject: str) -> str:
    """Issue a very short-lived (5 min) token that gates the second step of a
    2FA login — carries the user id but no session privileges of its own."""
    return _encode({"sub": subject}, timedelta(minutes=5), TokenType.CHALLENGE)


def decode_token(token: str, *, expected_type: TokenType) -> dict[str, Any]:
    """Decode + verify a JWT, enforcing the expected token type. Raise on any failure."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.secret_key.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError as exc:
        raise AuthenticationError("Invalid or expired token.", code="INVALID_TOKEN") from exc

    if payload.get("type") != expected_type.value:
        raise AuthenticationError("Token type mismatch.", code="INVALID_TOKEN_TYPE")
    if "sub" not in payload:
        raise AuthenticationError("Token missing subject.", code="INVALID_TOKEN")
    return payload


# ---------------------------------------------------------------------------
# Refresh tokens (opaque, DB-backed)
# ---------------------------------------------------------------------------

# Length in bytes → ~43 chars base64url. 32 bytes ≈ 256 bits of entropy.
_REFRESH_TOKEN_BYTES = 32


def generate_refresh_token() -> str:
    """Return a fresh cryptographically-random URL-safe token."""
    return secrets.token_urlsafe(_REFRESH_TOKEN_BYTES)


def hash_refresh_token(token: str) -> str:
    """Deterministic hash used to index refresh tokens without storing them plaintext."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
