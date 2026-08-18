"""Two-factor auth DTOs — enrolment + login-challenge flows."""

from __future__ import annotations

from pydantic import BaseModel, Field


class TwoFactorSetupResponse(BaseModel):
    """First step of enrolment: server issues a fresh secret and the provisioning
    URI the client renders / lets the user paste into their authenticator app."""

    secret: str
    provisioning_uri: str


class TwoFactorVerifyRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class TwoFactorDisableRequest(BaseModel):
    current_password: str = Field(min_length=1)
    code: str = Field(min_length=6, max_length=8)


class TwoFactorStatus(BaseModel):
    enabled: bool


class TwoFactorLoginRequest(BaseModel):
    """Second step of a 2FA-gated login — the caller returns with the
    `challenge_token` from step one plus the current authenticator code."""

    challenge_token: str
    code: str = Field(min_length=6, max_length=8)
