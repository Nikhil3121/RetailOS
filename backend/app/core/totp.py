"""RFC 6238 TOTP — pure-stdlib implementation.

Kept out of a dependency to avoid adding a package just for 30 lines of
crypto. Compatible with Google Authenticator, Authy, 1Password, and every
other TOTP-standard authenticator.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote


_PERIOD_SECONDS = 30
_DIGITS = 6


def _b32_decode(secret_b32: str) -> bytes:
    padded = secret_b32 + "=" * ((8 - len(secret_b32) % 8) % 8)
    return base64.b32decode(padded, casefold=True)


def _hotp(key: bytes, counter: int) -> str:
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (
        (digest[offset] & 0x7F) << 24
        | (digest[offset + 1] & 0xFF) << 16
        | (digest[offset + 2] & 0xFF) << 8
        | (digest[offset + 3] & 0xFF)
    )
    return str(code % (10**_DIGITS)).zfill(_DIGITS)


def generate_secret() -> str:
    """20 random bytes, base32-encoded (no padding, like Google Authenticator)."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def totp_now(secret_b32: str) -> str:
    """Current 6-digit code for a base32 secret."""
    return _hotp(_b32_decode(secret_b32), int(time.time() // _PERIOD_SECONDS))


def totp_verify(secret_b32: str, code: str, *, window: int = 1) -> bool:
    """Constant-time verify with ±`window` periods of clock-drift leeway.

    `window=1` accepts the previous, current, and next 30-second codes — the
    Google-recommended default that keeps enrolment forgiving without opening
    a meaningful replay window.
    """
    if not code or not code.strip().isdigit():
        return False
    try:
        key = _b32_decode(secret_b32)
    except Exception:  # noqa: BLE001
        return False
    normalized = code.strip().zfill(_DIGITS)
    current = int(time.time() // _PERIOD_SECONDS)
    for delta in range(-window, window + 1):
        if hmac.compare_digest(_hotp(key, current + delta), normalized):
            return True
    return False


def provisioning_uri(
    secret_b32: str, *, account: str, issuer: str = "RetailOS"
) -> str:
    """`otpauth://` URI compatible with any TOTP authenticator app."""
    label = quote(f"{issuer}:{account}", safe="")
    return (
        f"otpauth://totp/{label}"
        f"?secret={secret_b32}"
        f"&issuer={quote(issuer, safe='')}"
        f"&algorithm=SHA1&digits={_DIGITS}&period={_PERIOD_SECONDS}"
    )
