"""Health & readiness endpoints.

- ``/health``   liveness probe. Never touches the DB — must succeed even during outages.
- ``/ready``    readiness probe. Verifies the DB (and later Redis) are actually reachable.

The desktop client polls ``/health`` to render its connection status indicator.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, status
from sqlalchemy import text

from app import __version__
from app.api.deps import DbSession, SettingsDep
from app.schemas.health import HealthResponse, ReadinessResponse, SubsystemStatus

router = APIRouter()


@router.get(
    "/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
    summary="Liveness probe",
)
async def health(settings: SettingsDep) -> HealthResponse:
    """Return a lightweight envelope so orchestrators know the process is up."""
    return HealthResponse(
        status="ok",
        service=settings.project_name,
        version=__version__,
        environment=settings.environment.value,
        timestamp=datetime.now(timezone.utc),
    )


@router.get(
    "/ready",
    response_model=ReadinessResponse,
    summary="Readiness probe",
)
async def ready(db: DbSession) -> ReadinessResponse:
    """Verify each critical dependency is reachable before declaring the service ready."""
    subsystems: dict[str, SubsystemStatus] = {}

    # -- Database check --------------------------------------------------
    try:
        await db.execute(text("SELECT 1"))
        subsystems["database"] = SubsystemStatus(ok=True)
    except Exception as exc:  # noqa: BLE001 — health probe intentionally catches broadly
        subsystems["database"] = SubsystemStatus(ok=False, detail=type(exc).__name__)

    overall_ok = all(s.ok for s in subsystems.values())
    return ReadinessResponse(
        status="ready" if overall_ok else "degraded",
        subsystems=subsystems,
        timestamp=datetime.now(timezone.utc),
    )
