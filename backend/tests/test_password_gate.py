"""The password gate on destructive actions.

The client asked for a password before edit and delete. The important half of
that request is invisible from the shop floor: the check has to live on the
SERVER. A dialog drawn only in the renderer stops nobody, because the endpoint
is reachable directly — and the scenario the shop is actually worried about, an
unattended till with someone's session still open, is exactly the one a
client-side prompt does nothing about.

So these tests assert the gate from the outside: that a valid session alone is
NOT enough, that a confirmed password unlocks the action, and that the unlock
cannot be borrowed by a different user.
"""

from __future__ import annotations

from httpx import AsyncClient

from app.core.security import TokenType, _encode, hash_password
from app.db.models.user import User, UserRole
from app.db.session import session_scope
from datetime import timedelta

from tests._helpers import auth, elevate, login


async def _a_brand(client: AsyncClient, headers: dict[str, str]) -> str:
    r = await client.post("/api/v1/brands", headers=headers, json={"name": "Raymond"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------------------------------------------------------------------------
# The gate itself
# ---------------------------------------------------------------------------


async def test_a_valid_session_alone_cannot_delete(client: AsyncClient) -> None:
    """The whole point. Being logged in is not authorisation to destroy a record."""
    token = await login(client)
    h = auth(token)
    brand_id = await _a_brand(client, h)

    r = await client.delete(f"/api/v1/brands/{brand_id}", headers=h)
    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "ELEVATION_REQUIRED"

    # And the record is still there.
    r = await client.get(f"/api/v1/brands/{brand_id}", headers=h)
    assert r.status_code == 200


async def test_confirming_the_password_unlocks_the_delete(client: AsyncClient) -> None:
    token = await login(client)
    brand_id = await _a_brand(client, auth(token))

    r = await client.delete(f"/api/v1/brands/{brand_id}", headers=await elevate(client, token))
    assert r.status_code == 204, r.text


async def test_the_wrong_password_is_refused(client: AsyncClient) -> None:
    token = await login(client)
    r = await client.post(
        "/api/v1/auth/verify-password", headers=auth(token), json={"password": "not-it"}
    )
    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "INVALID_PASSWORD"


async def test_an_access_token_is_not_an_elevation_token(client: AsyncClient) -> None:
    """The two token types must not be interchangeable.

    If an access token satisfied the gate, every logged-in session would already
    hold the key and the whole feature would be decoration.
    """
    token = await login(client)
    brand_id = await _a_brand(client, auth(token))

    r = await client.delete(
        f"/api/v1/brands/{brand_id}",
        headers={**auth(token), "X-Elevation-Token": token},
    )
    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "INVALID_TOKEN_TYPE"


async def test_one_persons_confirmation_does_not_unlock_anothers_session(
    client: AsyncClient,
) -> None:
    """The five-minute window belongs to the person who typed the password.

    Without this check a manager's confirmation would leave the terminal unlocked
    for whoever sat down next — which is the exact risk the gate exists for.
    """
    manager_token = await login(client)
    manager_headers = await elevate(client, manager_token)

    async with session_scope() as db:
        db.add(
            User(
                email="cashier@example.com",
                full_name="Cashier",
                hashed_password=hash_password("cashier-password-1"),
                role=UserRole.OWNER,
                is_active=True,
            )
        )
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "cashier@example.com", "password": "cashier-password-1"},
    )
    cashier_token = r.json()["tokens"]["access_token"]

    brand_id = await _a_brand(client, auth(cashier_token))
    r = await client.delete(
        f"/api/v1/brands/{brand_id}",
        headers={
            **auth(cashier_token),
            "X-Elevation-Token": manager_headers["X-Elevation-Token"],
        },
    )
    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "ELEVATION_MISMATCH"


async def test_an_expired_confirmation_stops_working(client: AsyncClient) -> None:
    """A till left alone must not stay unlocked."""
    token = await login(client)
    h = auth(token)
    brand_id = await _a_brand(client, h)

    me = await client.get("/api/v1/auth/me", headers=h)
    stale = _encode(
        {"sub": me.json()["id"]}, timedelta(minutes=-1), TokenType.ELEVATION
    )

    r = await client.delete(
        f"/api/v1/brands/{brand_id}", headers={**h, "X-Elevation-Token": stale}
    )
    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "INVALID_TOKEN"


# ---------------------------------------------------------------------------
# Coverage — the gate has to be on the routes that matter, not just one
# ---------------------------------------------------------------------------


async def test_voiding_a_bill_is_gated(client: AsyncClient) -> None:
    """Voiding reverses stock AND removes takings. It belongs behind the gate."""
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h, json={"code": "PG", "name": "Gate Store"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Kurta", "unit_id": unit_id, "tax_rate": "5.00",
        "variants": [{"name": "Default", "sku": "PG-1", "cost_price": "400.00",
                      "mrp": "899.00", "selling_price": "899.00",
                      "reorder_point": "1.000", "reorder_quantity": "5.000"}]})
    variant_id = r.json()["variants"][0]["id"]

    await client.post("/api/v1/day-sessions/open", headers=h,
                      json={"store_id": store_id, "opening_cash": "0.00"})
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": variant_id, "delta": "5.000"}]})

    r = await client.post("/api/v1/sales", headers=h, json={
        "store_id": store_id,
        "lines": [{"variant_id": variant_id, "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "899.00"}]})
    assert r.status_code == 201, r.text
    sale_id = r.json()["id"]

    r = await client.post(f"/api/v1/sales/{sale_id}/void", headers=h,
                          json={"reason": "Rung up twice"})
    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "ELEVATION_REQUIRED"

    r = await client.post(f"/api/v1/sales/{sale_id}/void",
                          headers=await elevate(client, token),
                          json={"reason": "Rung up twice"})
    assert r.status_code == 200, r.text


async def test_every_delete_route_is_gated(client: AsyncClient) -> None:
    """Guard against a new DELETE being added without the gate.

    Inspecting the routing table rather than calling each endpoint: this has to
    keep working when someone adds a delete months from now, and a test that
    only knows about today's routes would not catch that.
    """
    from app.api.deps import require_elevation
    from app.main import app

    ungated: list[str] = []
    for route in app.routes:
        methods = getattr(route, "methods", set()) or set()
        if "DELETE" not in methods:
            continue
        deps = getattr(getattr(route, "dependant", None), "dependencies", [])
        if not any(d.call is require_elevation for d in deps):
            ungated.append(getattr(route, "path", "?"))

    assert ungated == [], f"DELETE routes with no password gate: {ungated}"
