"""External-channel dispatchers.

Design:
- One interface (`Dispatcher.send`).
- `LogDispatcher` always works (writes structured log lines).
- `EmailDispatcher` uses SMTP if the env vars are set, else falls back to logging.
- `WhatsAppDispatcher` + `PushDispatcher` are explicit stubs — they log a
  "not-configured" line so ops can see them fire without a real integration.

Real integrations (WhatsApp Business API, FCM/APNS) land in Phase 4 alongside
multi-tenant SaaS setup.
"""

from __future__ import annotations

import smtplib
from abc import ABC, abstractmethod
from dataclasses import dataclass
from email.message import EmailMessage

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.db.models.notification import NotificationChannel

log = get_logger(__name__)


@dataclass
class DispatchTarget:
    """Where the notification is going. `email`, `phone`, `push_token` are optional
    — each dispatcher uses only the fields it needs."""

    email: str | None = None
    phone: str | None = None
    push_token: str | None = None
    display_name: str | None = None


@dataclass
class DispatchMessage:
    title: str
    body: str
    severity: str
    kind: str


class Dispatcher(ABC):
    """A single channel."""

    channel: NotificationChannel

    @abstractmethod
    async def send(self, target: DispatchTarget, msg: DispatchMessage) -> bool:
        """Return True on success. Never raise for expected failures — log instead."""


# ---------------------------------------------------------------------------
# Log — always works
# ---------------------------------------------------------------------------


class LogDispatcher(Dispatcher):
    channel = NotificationChannel.IN_APP  # Fallback bucket; not a real channel.

    async def send(self, target: DispatchTarget, msg: DispatchMessage) -> bool:
        log.info(
            "notification.log",
            title=msg.title,
            severity=msg.severity,
            kind=msg.kind,
            recipient=target.display_name or target.email or "-",
        )
        return True


# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------


class EmailDispatcher(Dispatcher):
    channel = NotificationChannel.EMAIL

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    @property
    def is_configured(self) -> bool:
        s = self.settings
        return bool(s.smtp_host and s.smtp_from_email)

    async def send(self, target: DispatchTarget, msg: DispatchMessage) -> bool:
        if not self.is_configured:
            log.warning(
                "email.not_configured",
                title=msg.title,
                to=target.email or "-",
                note="SMTP env vars unset — logging instead of sending.",
            )
            return await LogDispatcher().send(target, msg)

        if not target.email:
            log.warning("email.no_recipient", title=msg.title)
            return False

        s = self.settings
        email = EmailMessage()
        email["Subject"] = f"[{msg.severity.upper()}] {msg.title}"
        email["From"] = f"{s.smtp_from_name} <{s.smtp_from_email}>"
        email["To"] = target.email
        email.set_content(msg.body or msg.title)

        try:
            with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
                if s.smtp_use_tls:
                    smtp.starttls()
                if s.smtp_username and s.smtp_password:
                    smtp.login(s.smtp_username, s.smtp_password.get_secret_value())
                smtp.send_message(email)
            log.info("email.sent", title=msg.title, to=target.email)
            return True
        except Exception as exc:  # noqa: BLE001 — dispatch never re-raises
            log.exception("email.send_failed", title=msg.title, to=target.email, err=type(exc).__name__)
            return False


# ---------------------------------------------------------------------------
# Stubs — WhatsApp + Push
# ---------------------------------------------------------------------------


class WhatsAppDispatcher(Dispatcher):
    """Stub. Real WhatsApp Business API integration lands in Phase 4."""

    channel = NotificationChannel.WHATSAPP

    async def send(self, target: DispatchTarget, msg: DispatchMessage) -> bool:
        log.info(
            "whatsapp.stub",
            title=msg.title,
            to=target.phone or "-",
            note="WhatsApp channel is a Phase-4 integration; message not actually sent.",
        )
        return True


class PushDispatcher(Dispatcher):
    """Stub. Real FCM/APNS push tokens land in Phase 4."""

    channel = NotificationChannel.PUSH

    async def send(self, target: DispatchTarget, msg: DispatchMessage) -> bool:
        log.info(
            "push.stub",
            title=msg.title,
            token=target.push_token or "-",
            note="Push channel is a Phase-4 integration; message not actually sent.",
        )
        return True


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def build_dispatchers() -> dict[NotificationChannel, Dispatcher]:
    return {
        NotificationChannel.EMAIL: EmailDispatcher(),
        NotificationChannel.WHATSAPP: WhatsAppDispatcher(),
        NotificationChannel.PUSH: PushDispatcher(),
        # IN_APP is handled by persisting the notification row itself — no dispatcher.
    }
