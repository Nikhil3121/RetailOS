"""Smoke tests for the health / readiness endpoints.

Milestone 1's acceptance test: the app boots, the health endpoint answers 200,
and the response conforms to the declared schema.
"""

from __future__ import annotations

from httpx import AsyncClient


async def test_health_ok(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "RetailOS"
    assert "version" in body
    assert "timestamp" in body


async def test_request_id_header_echoed(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health", headers={"X-Request-ID": "abc-123"})
    assert response.headers.get("X-Request-ID") == "abc-123"
