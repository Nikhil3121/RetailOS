"""Authentication DTOs — the shape of every credential flowing over the wire."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field

from app.schemas.user import UserRead


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=8, max_length=256)


class LogoutRequest(BaseModel):
    """Explicit refresh-token revocation. The access token is stateless and lapses on its own."""

    refresh_token: str = Field(min_length=8, max_length=256)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    """Uniform response — never leak whether an email exists in the system."""

    message: str = "If the email is registered, a reset link has been dispatched."
    # Dev-only convenience: when SMTP is not configured the token is echoed back
    # so it's testable locally without a real mailbox. Never populated in prod.
    debug_reset_token: str | None = None


class ResetPasswordRequest(BaseModel):
    reset_token: str = Field(min_length=8, max_length=1024)
    new_password: str = Field(min_length=8, max_length=128)


class TokenPair(BaseModel):
    """Response body for /login and /refresh."""

    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    expires_in: int = Field(description="Access-token lifetime in seconds.")


class LoginResponse(BaseModel):
    """Three shapes:
      * `requires_2fa=False`, `requires_otp=False` → `tokens` + `user`
        populated (normal flow, no second factor).
      * `requires_2fa=True` → `challenge_token` populated; the caller must
        POST /auth/login/2fa with the current authenticator code to finish.
        TOTP-enrolled users always take this path — no email OTP on top.
      * `requires_otp=True` → `challenge_token` + `otp_expires_in` populated;
        the caller must POST /auth/login/otp with the emailed 6-digit code.
        Fires only when `login_otp_required=True` server-side AND the user
        is NOT on TOTP.

    The three shapes are mutually exclusive: at most one of `requires_2fa`
    and `requires_otp` will be true on any given response.
    """

    requires_2fa: bool = False
    requires_otp: bool = False
    challenge_token: str | None = None
    otp_expires_in: int | None = Field(
        default=None,
        description="Seconds until the OTP challenge expires. Populated only when requires_otp=True.",
    )
    tokens: TokenPair | None = None
    user: UserRead | None = None


class LoginOtpVerifyRequest(BaseModel):
    """Second step of an OTP-gated login: present the challenge + the code the
    user typed from the email. The server hashes the code and compares it to
    the hash embedded in the challenge JWT — no server-side OTP state exists.
    """

    challenge_token: str = Field(min_length=8, max_length=1024)
    code: str = Field(
        min_length=6,
        max_length=6,
        pattern=r"^\d{6}$",
        description="Six-digit numeric code from the login OTP email.",
    )
