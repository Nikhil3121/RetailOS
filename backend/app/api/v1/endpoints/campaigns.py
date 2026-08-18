"""Campaign endpoints — create + list + send + inspect recipients."""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import CurrentUser, DbSession, require_min_role
from app.db.models.campaign import CampaignChannel
from app.db.models.user import UserRole
from app.schemas.campaign import (
    CampaignCreate,
    CampaignRead,
    CampaignRecipientRead,
    CampaignSegment,
    CampaignSummary,
    SegmentPreview,
)
from app.schemas.common import Page
from app.services.audit import AuditService
from app.services.campaign import CampaignService

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


@router.get(
    "",
    response_model=Page[CampaignSummary],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def list_campaigns(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
) -> Page[CampaignSummary]:
    rows, total = await CampaignService(db).list(page=page, page_size=page_size)
    return Page[CampaignSummary](
        items=[CampaignSummary.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post(
    "",
    response_model=CampaignRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def create_campaign(
    payload: CampaignCreate, db: DbSession, user: CurrentUser
) -> CampaignRead:
    campaign = await CampaignService(db).create(payload, created_by_user_id=user.id)
    await AuditService(db).log(
        action="campaign.create",
        summary=(
            f"{'Sent' if payload.send_now else 'Drafted'} campaign "
            f"'{campaign.title}' to {campaign.total_recipients} recipient(s) "
            f"via {campaign.channel.value}"
        ),
        entity_type="campaign",
        entity_id=campaign.id,
        actor=user,
        changes={
            "channel": campaign.channel.value,
            "total_recipients": campaign.total_recipients,
            "sent_count": campaign.sent_count,
            "failed_count": campaign.failed_count,
        },
    )
    return CampaignRead.model_validate(campaign)


@router.get(
    "/preview",
    response_model=SegmentPreview,
    summary="Count how many recipients a segment would target — for the compose UI",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def preview_segment(
    db: DbSession,
    channel: CampaignChannel = Query(...),
    segment: str = Query("all"),
    spent_min: Decimal | None = Query(None, ge=0),
) -> SegmentPreview:
    seg = CampaignSegment(segment=segment, spent_min=spent_min)  # type: ignore[arg-type]
    count = await CampaignService(db).preview_count(seg, channel=channel)
    return SegmentPreview(
        segment=seg.segment,
        spent_min=seg.spent_min,
        recipient_count=count,
    )


@router.get(
    "/{campaign_id}",
    response_model=CampaignRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def get_campaign(campaign_id: uuid.UUID, db: DbSession) -> CampaignRead:
    return CampaignRead.model_validate(await CampaignService(db).get(campaign_id))


@router.get(
    "/{campaign_id}/recipients",
    response_model=list[CampaignRecipientRead],
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def list_recipients(
    campaign_id: uuid.UUID, db: DbSession
) -> list[CampaignRecipientRead]:
    rows = await CampaignService(db).list_recipients(campaign_id)
    return [CampaignRecipientRead.model_validate(r) for r in rows]


@router.post(
    "/{campaign_id}/send",
    response_model=CampaignRead,
    summary="Dispatch a draft campaign now",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def send_campaign(
    campaign_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> CampaignRead:
    campaign = await CampaignService(db).send_existing(campaign_id)
    await AuditService(db).log(
        action="campaign.send",
        summary=(
            f"Sent campaign '{campaign.title}' to {campaign.total_recipients} "
            f"({campaign.sent_count} ok, {campaign.failed_count} failed)"
        ),
        entity_type="campaign",
        entity_id=campaign.id,
        actor=user,
    )
    return CampaignRead.model_validate(campaign)
