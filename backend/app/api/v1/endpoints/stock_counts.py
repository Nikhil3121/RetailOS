"""Physical stock audit — count sheets, variances, and posting them."""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import CurrentUser, DbSession, assert_store_access, require_min_role
from app.db.models.stock_count import StockCount, StockCountStatus
from app.db.models.user import UserRole
from app.schemas.stock_count import (
    StockCountCreate,
    StockCountLineRead,
    StockCountLinesUpsert,
    StockCountPostResult,
    StockCountRead,
    StockCountSummary,
    StockCountUpdate,
)
from app.services.stock_count import StockCountService

router = APIRouter(prefix="/stock-counts", tags=["stock-counts"])

_ZERO = Decimal("0.000")


def _to_read(count: StockCount) -> StockCountRead:
    """Shape a sheet for the wire, honouring the blind rule.

    THE BLIND RULE
    While a blind count is still open, the expected quantity is withheld from
    every response — `system_qty` and `variance` come back null. Sending them
    and asking the UI not to display them would be theatre: the figure is in
    the payload, one devtools tab away, and the whole point of a blind count
    is that the person holding the sheet cannot see what they are "supposed"
    to find.

    Once the sheet is POSTED the figures are released. At that point they are
    the audit record, and a manager reviewing a write-off has to see them.
    """
    hide = count.is_blind and count.status == StockCountStatus.DRAFT

    lines: list[StockCountLineRead] = []
    for line in count.lines:
        variant = line.variant
        product = getattr(variant, "product", None) if variant is not None else None
        lines.append(
            StockCountLineRead(
                id=line.id,
                variant_id=line.variant_id,
                system_qty=None if hide else line.system_qty,
                counted_qty=line.counted_qty,
                variance=None if hide else line.variance,
                reason=line.reason,
                sku=getattr(variant, "sku", None),
                product_name=getattr(product, "name", None),
                variant_label=getattr(variant, "name", None),
            )
        )

    variance_lines = sum(1 for line in count.lines if line.variance != 0)
    net = sum((line.variance for line in count.lines), start=_ZERO)

    return StockCountRead(
        id=count.id,
        store_id=count.store_id,
        reference=count.reference,
        scope=count.scope,
        status=count.status,
        is_blind=count.is_blind,
        notes=count.notes,
        counted_by_user_id=count.counted_by_user_id,
        posted_by_user_id=count.posted_by_user_id,
        posted_at=count.posted_at,
        lines=lines,
        line_count=len(count.lines),
        variance_line_count=None if hide else variance_lines,
        net_variance=None if hide else net,
    )


@router.get(
    "",
    response_model=list[StockCountSummary],
    summary="Count sheets, newest first.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_counts(
    db: DbSession,
    store_id: uuid.UUID | None = Query(default=None),
    count_status: StockCountStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[StockCountSummary]:
    counts = await StockCountService(db).list(
        store_id=store_id, status=count_status, limit=limit
    )
    return [
        StockCountSummary(
            id=c.id,
            store_id=c.store_id,
            reference=c.reference,
            scope=c.scope,
            status=c.status,
            is_blind=c.is_blind,
            line_count=len(c.lines),
            created_at=c.created_at.isoformat() if c.created_at else None,
            posted_at=c.posted_at,
        )
        for c in counts
    ]


@router.get(
    "/{count_id}",
    response_model=StockCountRead,
    summary="One count sheet with its lines.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def get_count(count_id: uuid.UUID, db: DbSession) -> StockCountRead:
    return _to_read(await StockCountService(db).get(count_id))


@router.post(
    "",
    response_model=StockCountRead,
    status_code=status.HTTP_201_CREATED,
    summary="Open a count sheet.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def create_count(
    payload: StockCountCreate, db: DbSession, user: CurrentUser
) -> StockCountRead:
    assert_store_access(user, payload.store_id)
    count = await StockCountService(db).create(payload, user_id=user.id)
    return _to_read(count)


@router.patch(
    "/{count_id}",
    response_model=StockCountRead,
    summary="Rename or re-scope an open sheet.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def update_count(
    count_id: uuid.UUID, payload: StockCountUpdate, db: DbSession, user: CurrentUser
) -> StockCountRead:
    service = StockCountService(db)
    assert_store_access(user, (await service.get(count_id)).store_id)
    return _to_read(await service.update(count_id, payload))


@router.put(
    "/{count_id}/lines",
    response_model=StockCountRead,
    summary="Save counted quantities. Re-counting an item replaces its line.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def upsert_lines(
    count_id: uuid.UUID,
    payload: StockCountLinesUpsert,
    db: DbSession,
    user: CurrentUser,
) -> StockCountRead:
    service = StockCountService(db)
    assert_store_access(user, (await service.get(count_id)).store_id)
    return _to_read(await service.upsert_lines(count_id, payload.lines))


@router.delete(
    "/{count_id}/lines/{line_id}",
    response_model=StockCountRead,
    summary="Remove a line entered by mistake.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def delete_line(
    count_id: uuid.UUID, line_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> StockCountRead:
    service = StockCountService(db)
    assert_store_access(user, (await service.get(count_id)).store_id)
    return _to_read(await service.delete_line(count_id, line_id))


@router.post(
    "/{count_id}/post",
    response_model=StockCountPostResult,
    summary="Accept the variances and correct the stock ledger.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def post_count(
    count_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> StockCountPostResult:
    """Manager and above.

    Posting a count writes off stock. A cashier may hold the sheet and enter
    what they find — that is the job — but signing off a shrinkage figure is a
    money decision, and the person who counted should not be the only person
    who ever sees it.
    """
    service = StockCountService(db)
    assert_store_access(user, (await service.get(count_id)).store_id)
    count, posted, net, drifted = await service.post(count_id, user_id=user.id)
    return StockCountPostResult(
        count_id=count.id,
        status=count.status,
        movements_posted=posted,
        net_variance=net,
        drifted_variant_ids=drifted,
    )


@router.post(
    "/{count_id}/cancel",
    response_model=StockCountRead,
    summary="Abandon a sheet without touching stock.",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def cancel_count(
    count_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> StockCountRead:
    service = StockCountService(db)
    assert_store_access(user, (await service.get(count_id)).store_id)
    return _to_read(await service.cancel(count_id))


@router.delete(
    "/{count_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a draft sheet. A posted one cannot be deleted.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def delete_count(count_id: uuid.UUID, db: DbSession, user: CurrentUser) -> None:
    service = StockCountService(db)
    assert_store_access(user, (await service.get(count_id)).store_id)
    await service.delete(count_id)
