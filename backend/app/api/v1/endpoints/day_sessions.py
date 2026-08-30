"""Day session (open/close) endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import CurrentUser, DbSession, require_min_role
from app.db.models.user import UserRole
from app.schemas.day_session import (
    CloseSessionRequest,
    DaySessionRead,
    DaySessionSummary,
    OpenSessionRequest,
)
from app.services.day_session import DaySessionService

router = APIRouter(prefix="/day-sessions", tags=["day-sessions"])


@router.get(
    "/current",
    response_model=DaySessionRead | None,
    summary="Return the OPEN session for a store (if any).",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def get_current(
    db: DbSession, store_id: uuid.UUID = Query(...)
) -> DaySessionRead | None:
    session = await DaySessionService(db).get_open_for_store(store_id)
    return DaySessionRead.model_validate(session) if session else None


@router.get(
    "",
    response_model=list[DaySessionRead],
    summary="Recent sessions for a store, newest first (open and closed).",
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_sessions(
    db: DbSession,
    store_id: uuid.UUID = Query(...),
    limit: int = Query(10, ge=1, le=100),
) -> list[DaySessionRead]:
    """Read-only. Lets a client show the LAST shift and whether it was
    restated, which `/current` cannot do because it returns only OPEN rows."""
    sessions = await DaySessionService(db).recent_for_store(store_id, limit)
    return [DaySessionRead.model_validate(s) for s in sessions]


@router.post(
    "/open",
    response_model=DaySessionRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def open_session(
    payload: OpenSessionRequest, db: DbSession, user: CurrentUser
) -> DaySessionRead:
    session = await DaySessionService(db).open(payload, user_id=user.id)
    return DaySessionRead.model_validate(session)


@router.post(
    "/{session_id}/close",
    response_model=DaySessionRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def close_session(
    session_id: uuid.UUID,
    payload: CloseSessionRequest,
    db: DbSession,
    user: CurrentUser,
) -> DaySessionRead:
    session = await DaySessionService(db).close(session_id, payload, user_id=user.id)
    return DaySessionRead.model_validate(session)


@router.get(
    "/{session_id}/summary",
    response_model=DaySessionSummary,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def session_summary(session_id: uuid.UUID, db: DbSession) -> DaySessionSummary:
    return await DaySessionService(db).summary(session_id)
