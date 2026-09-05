"""Price list endpoints — wholesale / retail / dealer rate cards."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import CurrentUser, DbSession, require_elevation, require_min_role
from app.db.models.user import UserRole
from app.schemas.price_list import (
    PriceListCreate,
    PriceListItemRead,
    PriceListItemsSet,
    PriceListRead,
    PriceListUpdate,
    PriceResolveRequest,
    ResolvedPrice,
)
from app.services.audit import AuditService
from app.services.price_list import PriceListService

router = APIRouter(prefix="/price-lists", tags=["price-lists"])


@router.get("", response_model=list[PriceListRead], summary="Every price list.")
async def list_price_lists(
    db: DbSession,
    include_inactive: bool = Query(False),
) -> list[PriceListRead]:
    rows = await PriceListService(db).list_all(include_inactive=include_inactive)
    return [PriceListRead.model_validate(r) for r in rows]


@router.post(
    "",
    response_model=PriceListRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a price list.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def create_price_list(
    payload: PriceListCreate, db: DbSession, user: CurrentUser
) -> PriceListRead:
    pl = await PriceListService(db).create(payload)
    await AuditService(db).log(
        action="price_list.created",
        summary=f"Created price list {pl.code} ({pl.name})",
        entity_type="price_list",
        entity_id=pl.id,
        actor=user,
    )
    return PriceListRead.model_validate(pl)


@router.patch(
    "/{price_list_id}",
    response_model=PriceListRead,
    summary="Rename, archive, or set a list as the default.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def update_price_list(
    price_list_id: uuid.UUID,
    payload: PriceListUpdate,
    db: DbSession,
    user: CurrentUser,
) -> PriceListRead:
    pl = await PriceListService(db).update(price_list_id, payload)
    await AuditService(db).log(
        action="price_list.updated",
        summary=f"Updated price list {pl.code}",
        entity_type="price_list",
        entity_id=pl.id,
        actor=user,
        changes=payload.model_dump(exclude_unset=True, mode="json"),
    )
    return PriceListRead.model_validate(pl)


@router.get(
    "/{price_list_id}/items",
    response_model=list[PriceListItemRead],
    summary="Every rate on this list. Absent variants use their own price.",
)
async def list_items(price_list_id: uuid.UUID, db: DbSession) -> list[PriceListItemRead]:
    return await PriceListService(db).items_for_display(price_list_id)


@router.put(
    "/{price_list_id}/items",
    response_model=list[PriceListItemRead],
    summary="Upsert rates onto this list. Rates not named are left untouched.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def set_items(
    price_list_id: uuid.UUID,
    payload: PriceListItemsSet,
    db: DbSession,
    user: CurrentUser,
) -> list[PriceListItemRead]:
    rows = await PriceListService(db).set_items(price_list_id, payload.items)
    await AuditService(db).log(
        action="price_list.rates_set",
        summary=f"Set {len(rows)} rate(s) on price list {price_list_id}",
        entity_type="price_list",
        entity_id=price_list_id,
        actor=user,
        changes={"count": len(rows)},
    )
    return [PriceListItemRead.model_validate(r) for r in rows]


@router.delete(
    "/{price_list_id}/items/{variant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Drop a rate so the variant falls back to its own selling price.",
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.MANAGER))],
)
async def remove_item(
    price_list_id: uuid.UUID, variant_id: uuid.UUID, db: DbSession
) -> None:
    await PriceListService(db).remove_item(price_list_id, variant_id)


@router.post(
    "/resolve",
    response_model=list[ResolvedPrice],
    summary="What these variants cost for this customer.",
)
async def resolve_prices(
    payload: PriceResolveRequest, db: DbSession
) -> list[ResolvedPrice]:
    """Billing calls this for the whole cart at once.

    It is the SAME function the sale service uses when it stores a line, so the
    price shown on screen and the price written to the bill cannot diverge.
    """
    found = await PriceListService(db).resolve(
        variant_ids=payload.variant_ids, customer_id=payload.customer_id
    )
    return [found[v] for v in payload.variant_ids if v in found]
