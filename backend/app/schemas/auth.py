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
    """Two shapes:
      * `requires_2fa=False` → `tokens` + `user` populated (normal flow).
      * `requires_2fa=True`  → `challenge_token` populated; the caller must
        POST /auth/login/2fa with the current authenticator code to finish.
    """

    requires_2fa: bool = False
    challenge_token: str | None = None
    tokens: TokenPair | None = None
    user: UserRead | None = None
