"""Login-OTP service — email a 6-digit code, verify a challenge token.

Stateless: the code hash lives inside the JWT (see
`create_login_otp_challenge`), so we never need a database table or a
Redis instance to remember pending OTPs. Trade-off: an issued challenge
cannot be revoked before its 60-second expiry — acceptable for a
short-lived login gate.

Delivery falls back to structured log output when SMTP isn't configured,
so the flow is testable end-to-end in dev / pilot without external mail.
"""

from __future__ import annotations

import secrets
import smtplib
from email.message import EmailMessage

from app.core.config import get_settings
from app.core.exceptions import AuthenticationError
from app.core.logging import get_logger
from app.core.security import (
    TokenType,
    create_login_otp_challenge,
    decode_token,
    hash_otp_code,
)
from app.db.models.user import User

log = get_logger(__name__)


class LoginOtpService:
    """Issues + verifies short-lived login OTP challenges."""

    OTP_LENGTH = 6
    OTP_SECONDS = 60

    def issue(self, user: User) -> tuple[str, int]:
        """Generate an OTP, deliver it to the user, return (challenge_token, expires_in_seconds).

        The plaintext code goes to the user via email (or console log in
        SMTP-less dev). The hash goes into the JWT the caller receives —
        that JWT will be presented back by the client on /auth/login/otp.
        """
        code = _generate_numeric_code(self.OTP_LENGTH)
        challenge = create_login_otp_challenge(
            subject=str(user.id),
            code_hash=hash_otp_code(code),
            seconds=self.OTP_SECONDS,
        )
        self._deliver(user, code)
        return challenge, self.OTP_SECONDS

    def verify(self, *, challenge_token: str, code: str) -> str:
        """Return the user id embedded in the challenge if `code` matches.

        Raises `AuthenticationError` on any mismatch (bad code, expired
        token, tampered hash). Distinguishing "wrong code" from "expired
        token" leaks info to an attacker — the same error surface makes
        blind guessing indistinguishable from stale-token replay.
        """
        payload = decode_token(challenge_token, expected_type=TokenType.LOGIN_OTP)
        expected_hash = payload.get("otp_hash")
        if not expected_hash:
            raise AuthenticationError("Malformed OTP challenge.", code="INVALID_OTP")

        if hash_otp_code(code.strip()) != expected_hash:
            raise AuthenticationError("Wrong or expired code.", code="INVALID_OTP")

        return str(payload["sub"])

    # ------------------------------------------------------------------
    # Delivery
    # ------------------------------------------------------------------
    def _deliver(self, user: User, code: str) -> None:
        """Send the code to the user via SMTP if configured, otherwise log it.

        The log path is DEV/PILOT-only — it's a structured warning so we can
        grep for it during testing, and it will never fire in a production
        deploy that has SMTP configured.
        """
        s = get_settings()
        if s.smtp_host and s.smtp_from_email and user.email:
            email = EmailMessage()
            email["Subject"] = "Your RetailOS login code"
            email["From"] = f"{s.smtp_from_name} <{s.smtp_from_email}>"
            email["To"] = user.email
            email.set_content(
                f"Your login code is: {code}\n\n"
                f"It expires in {self.OTP_SECONDS} seconds. "
                "If you didn't try to sign in, someone else may have your "
                "password — change it immediately.\n"
            )
            try:
                with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
                    if s.smtp_use_tls:
                        smtp.starttls()
                    if s.smtp_username and s.smtp_password:
                        smtp.login(
                            s.smtp_username,
                            s.smtp_password.get_secret_value(),
                        )
                    smtp.send_message(email)
                log.info("login_otp_email_sent", email=user.email)
                return
            except Exception:
                # Don't leak the failure to the caller — falling through to
                # the log path means login can still proceed while ops
                # investigate the SMTP outage. Never log the code as part
                # of an exception trace.
                log.exception("login_otp_smtp_send_failed", email=user.email)

        log.warning(
            "login_otp_console_delivery",
            email=user.email,
            code=code,
            expires_in_seconds=self.OTP_SECONDS,
            note=(
                "SMTP is not configured. This log line is the ONLY place the "
                "code exists — configure SMTP_HOST + SMTP_FROM_EMAIL to send "
                "real email."
            ),
        )


def _generate_numeric_code(length: int) -> str:
    """Cryptographically-random N-digit numeric string. Zero-padded so the
    total number of possible codes is a full 10^length, not a leading-digit
    subset."""
    upper = 10**length
    return f"{secrets.randbelow(upper):0{length}d}"
