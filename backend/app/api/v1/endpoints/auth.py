"""Authentication endpoints.

The endpoint layer stays deliberately thin: it deserializes the request into a
schema, calls a single service method, and serializes the result. Rules live in
`app.services.auth`.
"""

from __future__ import annotations

from fastapi import APIRouter, Request, status

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.core.rate_limit import limiter as _auth_limiter
from app.services.audit import AuditService
from app.schemas.auth import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginOtpVerifyRequest,
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    RefreshRequest,
    ResetPasswordRequest,
    TokenPair,
)
from app.schemas.two_factor import (
    TwoFactorDisableRequest,
    TwoFactorLoginRequest,
    TwoFactorSetupResponse,
    TwoFactorStatus,
    TwoFactorVerifyRequest,
)
from app.schemas.user import UserRead
from app.services.auth import AuthService
from app.services.two_factor import TwoFactorService

router = APIRouter(prefix="/auth", tags=["auth"])

# _auth_limiter is the SHARED app.core.rate_limit.limiter (imported above).
# Decorating a route with `_auth_limiter.limit("5/minute")` overrides the
# app-wide default (200/min) for that endpoint. Keyed by client IP so a
# stolen password can't be sprayed against 10k users from one attacker box.


@router.post("/login", response_model=LoginResponse, summary="Exchange credentials for a token pair")
@_auth_limiter.limit("5/minute")
async def login(payload: LoginRequest, db: DbSession, request: Request) -> LoginResponse:
    service = AuthService(db)
    settings = get_settings()
    user = await service.authenticate(email=payload.email, password=payload.password)

    # 2FA gate — password check passed but this account has an authenticator
    # enrolled, so return a short-lived challenge instead of the token pair.
    # The caller must POST /auth/login/2fa with the current code to finish.
    # Priority: TOTP > email OTP. If a user has TOTP, they don't also need
    # the email OTP on top — that would be user-hostile with no security gain.
    if user.totp_enabled:
        return LoginResponse(
            requires_2fa=True,
            challenge_token=service.issue_2fa_challenge(user),
        )

    # Email-OTP gate — opt-in via settings.login_otp_required. Issues a
    # 6-digit code delivered by email (or console log when SMTP is off,
    # for pilot/dev). Caller must POST /auth/login/otp with the code.
    if settings.login_otp_required:
        challenge, expires_in = service.issue_login_otp(user)
        return LoginResponse(
            requires_otp=True,
            challenge_token=challenge,
            otp_expires_in=expires_in,
        )

    tokens = await service.issue_token_pair(user)
    await AuditService(db).log(
        action="user.login",
        summary=f"{user.email} signed in",
        entity_type="user",
        entity_id=user.id,
        actor=user,
        ip_address=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent"),
    )
    return LoginResponse(tokens=tokens, user=UserRead.model_validate(user))


@router.post(
    "/login/otp",
    response_model=LoginResponse,
    summary="Second step of an OTP-gated login — exchange challenge + code for tokens",
)
@_auth_limiter.limit("5/minute")
async def login_otp(
    payload: LoginOtpVerifyRequest, db: DbSession, request: Request
) -> LoginResponse:
    # Rate-limited at the same 5/min as /login so an attacker can't blast
    # 6-digit codes against a stolen challenge_token from one IP.
    auth = AuthService(db)
    user = await auth.resolve_login_otp(
        challenge_token=payload.challenge_token, code=payload.code
    )
    tokens = await auth.issue_token_pair(user)
    await AuditService(db).log(
        action="user.login_otp",
        summary=f"{user.email} completed email OTP",
        entity_type="user",
        entity_id=user.id,
        actor=user,
        ip_address=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent"),
    )
    return LoginResponse(tokens=tokens, user=UserRead.model_validate(user))


@router.post(
    "/login/2fa",
    response_model=LoginResponse,
    summary="Second step of a 2FA-gated login — exchange challenge + code for tokens",
)
@_auth_limiter.limit("5/minute")
async def login_2fa(
    payload: TwoFactorLoginRequest, db: DbSession, request: Request
) -> LoginResponse:
    auth = AuthService(db)
    user = await auth.resolve_2fa_challenge(payload.challenge_token)
    # Verify the TOTP code against the user's stored secret.
    await TwoFactorService(db).verify_code_for_user(user.id, payload.code)
    tokens = await auth.issue_token_pair(user)
    await AuditService(db).log(
        action="user.login_2fa",
        summary=f"{user.email} completed 2FA",
        entity_type="user",
        entity_id=user.id,
        actor=user,
        ip_address=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent"),
    )
    return LoginResponse(tokens=tokens, user=UserRead.model_validate(user))


@router.post("/refresh", response_model=TokenPair, summary="Rotate an active refresh token")
@_auth_limiter.limit("30/minute")
async def refresh(payload: RefreshRequest, request: Request, db: DbSession) -> TokenPair:
    # Refresh is called more often than login (every 30 min per active user)
    # so its ceiling is 30/min per IP — enough headroom for a shop with 5
    # counters on one router, tight enough to shut down a stolen-token
    # replay attempt.
    service = AuthService(db)
    return await service.refresh(refresh_token=payload.refresh_token)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke a refresh token",
)
async def logout(
    payload: LogoutRequest, db: DbSession, request: Request
) -> None:
    service = AuthService(db)
    await service.logout(refresh_token=payload.refresh_token)
    await AuditService(db).log(
        action="user.logout",
        summary="Refresh token revoked",
        ip_address=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent"),
    )


@router.get("/me", response_model=UserRead, summary="Return the caller's profile")
async def me(user: CurrentUser) -> UserRead:
    return UserRead.model_validate(user)


@router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change the caller's password. Revokes all other sessions.",
)
async def change_password(
    payload: ChangePasswordRequest,
    user: CurrentUser,
    db: DbSession,
) -> None:
    service = AuthService(db)
    await service.change_password(
        user=user,
        current_password=payload.current_password,
        new_password=payload.new_password,
    )


@router.post(
    "/forgot-password",
    response_model=ForgotPasswordResponse,
    summary="Request a password reset token",
)
@_auth_limiter.limit("3/minute")
async def forgot_password(
    payload: ForgotPasswordRequest, request: Request, db: DbSession
) -> ForgotPasswordResponse:
    # Tighter still — a forgot-password endpoint doubles as an email
    # enumeration oracle. 3/min per IP is comfortable for a legitimate user
    # who typoed their email, punishing for anyone scripting the endpoint.
    service = AuthService(db)
    token = await service.request_password_reset(email=payload.email)

    # When SMTP is configured the token is emailed by the notification pipeline.
    # In dev (no SMTP) we return the token in the response body so it's testable
    # locally without a real mailbox — never in production.
    settings = get_settings()
    return ForgotPasswordResponse(
        debug_reset_token=token if (token and not settings.is_production) else None,
    )


@router.post(
    "/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Consume a reset token to set a new password",
)
@_auth_limiter.limit("5/minute")
async def reset_password(
    payload: ResetPasswordRequest, request: Request, db: DbSession
) -> None:
    service = AuthService(db)
    await service.reset_password(
        reset_token=payload.reset_token,
        new_password=payload.new_password,
    )


# ---------------------------------------------------------------------------
# Two-factor auth (TOTP)
# ---------------------------------------------------------------------------


@router.get(
    "/2fa/status",
    response_model=TwoFactorStatus,
    summary="Whether 2FA is enabled on the current user",
)
async def two_factor_status(user: CurrentUser) -> TwoFactorStatus:
    return TwoFactorStatus(enabled=bool(user.totp_enabled))


@router.post(
    "/2fa/setup",
    response_model=TwoFactorSetupResponse,
    summary="Start 2FA enrolment — returns a fresh secret + provisioning URI",
)
async def two_factor_setup(
    user: CurrentUser, db: DbSession
) -> TwoFactorSetupResponse:
    secret, uri = await TwoFactorService(db).start_enrolment(user)
    return TwoFactorSetupResponse(secret=secret, provisioning_uri=uri)


@router.post(
    "/2fa/verify",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Confirm the code from the authenticator app to enable 2FA",
)
async def two_factor_verify(
    payload: TwoFactorVerifyRequest, user: CurrentUser, db: DbSession
) -> None:
    await TwoFactorService(db).confirm_enrolment(user, payload.code)
    await AuditService(db).log(
        action="user.2fa_enabled",
        summary=f"{user.email} enabled two-factor auth",
        entity_type="user",
        entity_id=user.id,
        actor=user,
    )


@router.post(
    "/2fa/disable",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Turn 2FA off — requires the current password AND a valid code",
)
async def two_factor_disable(
    payload: TwoFactorDisableRequest, user: CurrentUser, db: DbSession
) -> None:
    await TwoFactorService(db).disable(
        user, current_password=payload.current_password, code=payload.code
    )
    await AuditService(db).log(
        action="user.2fa_disabled",
        summary=f"{user.email} disabled two-factor auth",
        entity_type="user",
        entity_id=user.id,
        actor=user,
    )
