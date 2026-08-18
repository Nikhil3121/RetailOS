"""Bulk campaign service — resolves a segment, fans out to recipients, and
dispatches via the configured channel dispatchers."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError, ValidationError
from app.core.logging import get_logger
from app.db.models.campaign import (
    Campaign,
    CampaignChannel,
    CampaignRecipient,
    CampaignStatus,
    RecipientStatus,
)
from app.db.models.customer import Customer
from app.db.models.sale import Sale, SaleStatus
from app.schemas.campaign import CampaignCreate, CampaignSegment
from app.services.notification_dispatchers import (
    DispatchMessage,
    DispatchTarget,
    EmailDispatcher,
    LogDispatcher,
    WhatsAppDispatcher,
)


log = get_logger(__name__)


class CampaignService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Segment resolution
    # ------------------------------------------------------------------
    async def resolve_segment(
        self, segment: CampaignSegment, *, channel: CampaignChannel
    ) -> list[Customer]:
        """Return the customers matching `segment` who have a usable contact
        for the chosen channel (phone for SMS/WhatsApp, email for email)."""
        stmt = select(Customer).where(Customer.is_active.is_(True))

        needs_phone = channel in (CampaignChannel.SMS, CampaignChannel.WHATSAPP)
        if needs_phone:
            stmt = stmt.where(Customer.phone.is_not(None), Customer.phone != "")
        else:
            stmt = stmt.where(Customer.email.is_not(None), Customer.email != "")

        today = date.today()
        seg = segment.segment

        if seg == "active_30d" or seg == "active_90d":
            days = 30 if seg == "active_30d" else 90
            cutoff = today - timedelta(days=days)
            active_ids_subq = (
                select(Sale.customer_id)
                .where(
                    Sale.status == SaleStatus.COMPLETED,
                    Sale.customer_id.is_not(None),
                    func.date(Sale.created_at) >= cutoff,
                )
                .subquery()
            )
            stmt = stmt.where(Customer.id.in_(select(active_ids_subq)))

        elif seg == "birthday_month":
            stmt = stmt.where(Customer.date_of_birth.is_not(None))
            stmt = stmt.where(extract("month", Customer.date_of_birth) == today.month)

        elif seg == "anniversary_month":
            stmt = stmt.where(Customer.anniversary.is_not(None))
            stmt = stmt.where(extract("month", Customer.anniversary) == today.month)

        elif seg == "never_bought":
            bought_ids_subq = (
                select(Sale.customer_id)
                .where(
                    Sale.status == SaleStatus.COMPLETED,
                    Sale.customer_id.is_not(None),
                )
                .subquery()
            )
            stmt = stmt.where(Customer.id.not_in(select(bought_ids_subq)))

        elif seg == "spent_min":
            threshold = Decimal(str(segment.spent_min or 0))
            if threshold <= 0:
                raise ValidationError(
                    "spent_min segment needs a positive minimum spend.",
                    code="INVALID_SEGMENT",
                )
            spender_ids_subq = (
                select(Sale.customer_id)
                .where(
                    Sale.status == SaleStatus.COMPLETED,
                    Sale.customer_id.is_not(None),
                )
                .group_by(Sale.customer_id)
                .having(func.coalesce(func.sum(Sale.grand_total), 0) >= threshold)
                .subquery()
            )
            stmt = stmt.where(Customer.id.in_(select(spender_ids_subq)))

        # "all" falls through — every active customer with a usable contact.
        rows = (await self.db.scalars(stmt.order_by(Customer.name))).all()
        return list(rows)

    async def preview_count(
        self, segment: CampaignSegment, *, channel: CampaignChannel
    ) -> int:
        return len(await self.resolve_segment(segment, channel=channel))

    # ------------------------------------------------------------------
    # Create + send
    # ------------------------------------------------------------------
    async def create(
        self,
        payload: CampaignCreate,
        *,
        created_by_user_id: uuid.UUID | None,
    ) -> Campaign:
        recipients = await self.resolve_segment(payload.segment, channel=payload.channel)

        campaign = Campaign(
            title=payload.title,
            channel=payload.channel,
            message_body=payload.message_body,
            segment_json=payload.segment.model_dump(mode="json"),
            status=CampaignStatus.DRAFT,
            total_recipients=len(recipients),
        )
        self.db.add(campaign)
        await self.db.flush()

        for c in recipients:
            self.db.add(
                CampaignRecipient(
                    campaign_id=campaign.id,
                    customer_id=c.id,
                    phone=c.phone,
                    email=c.email,
                    status=RecipientStatus.QUEUED,
                )
            )
        campaign.created_by_user_id = created_by_user_id
        await self.db.flush()

        if payload.send_now:
            await self._dispatch(campaign)

        return await self.get(campaign.id)

    async def send_existing(self, campaign_id: uuid.UUID) -> Campaign:
        campaign = await self.get(campaign_id)
        if campaign.status is CampaignStatus.SENT:
            raise ValidationError(
                "Campaign has already been sent.", code="CAMPAIGN_ALREADY_SENT"
            )
        await self._dispatch(campaign)
        return await self.get(campaign.id)

    async def _dispatch(self, campaign: Campaign) -> None:
        """Iterate every queued recipient, fire the dispatcher, record outcome."""
        campaign.status = CampaignStatus.SENDING
        await self.db.flush()

        dispatcher = self._dispatcher_for(campaign.channel)
        sent = 0
        failed = 0
        now = datetime.now(timezone.utc)

        # Load recipients with a fresh query — we may have just inserted them.
        recipients = (
            await self.db.scalars(
                select(CampaignRecipient)
                .where(
                    CampaignRecipient.campaign_id == campaign.id,
                    CampaignRecipient.status == RecipientStatus.QUEUED,
                )
                .options(selectinload(CampaignRecipient.customer))
            )
        ).all()

        for r in recipients:
            target = DispatchTarget(
                email=r.email,
                phone=r.phone,
                display_name=r.customer.name if r.customer else None,
            )
            msg = DispatchMessage(
                title=campaign.title,
                body=_render_message(campaign.message_body, r.customer),
                severity="info",
                kind="campaign",
            )
            try:
                ok = await dispatcher.send(target, msg)
            except Exception as exc:  # noqa: BLE001 — never raise up the loop
                log.exception("campaign.recipient_failed", campaign_id=str(campaign.id))
                r.status = RecipientStatus.FAILED
                r.error = f"{type(exc).__name__}: {exc}"[:512]
                failed += 1
                continue

            if ok:
                r.status = RecipientStatus.SENT
                r.sent_at = now
                sent += 1
            else:
                r.status = RecipientStatus.FAILED
                r.error = "Dispatcher returned False (see server logs)."
                failed += 1

        campaign.sent_count = sent
        campaign.failed_count = failed
        campaign.sent_at = now
        campaign.status = (
            CampaignStatus.SENT if failed == 0 else CampaignStatus.SENT
        )
        # Even with partial failures, mark the run "sent" — the per-recipient
        # rows carry the granular status.
        await self.db.flush()

    def _dispatcher_for(self, channel: CampaignChannel):
        if channel is CampaignChannel.WHATSAPP:
            return WhatsAppDispatcher()
        if channel is CampaignChannel.EMAIL:
            return EmailDispatcher()
        if channel is CampaignChannel.SMS:
            # SMS is a Phase-4 integration; log for now so campaigns still work
            # end-to-end in dev and record recipient status truthfully.
            return LogDispatcher()
        return LogDispatcher()

    # ------------------------------------------------------------------
    # Read + list
    # ------------------------------------------------------------------
    async def get(self, campaign_id: uuid.UUID) -> Campaign:
        campaign = await self.db.scalar(
            select(Campaign).where(Campaign.id == campaign_id)
        )
        if campaign is None:
            raise NotFoundError("Campaign not found.", code="CAMPAIGN_NOT_FOUND")
        return campaign

    async def list(
        self, *, page: int = 1, page_size: int = 50
    ) -> tuple[list[Campaign], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 200)
        total = await self.db.scalar(select(func.count()).select_from(Campaign)) or 0
        rows = (
            await self.db.scalars(
                select(Campaign)
                .order_by(Campaign.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    async def list_recipients(
        self, campaign_id: uuid.UUID
    ) -> list[CampaignRecipient]:
        return list(
            (
                await self.db.scalars(
                    select(CampaignRecipient)
                    .where(CampaignRecipient.campaign_id == campaign_id)
                    .order_by(CampaignRecipient.created_at)
                )
            ).all()
        )


def _render_message(body: str, customer: Any | None) -> str:
    """Very small placeholder engine: {name}, {phone}, {email}."""
    if not customer:
        return body
    return (
        body.replace("{name}", customer.name or "")
        .replace("{phone}", customer.phone or "")
        .replace("{email}", customer.email or "")
    )
