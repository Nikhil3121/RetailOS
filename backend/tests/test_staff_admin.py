"""Managing staff — the full create / read / update / delete cycle.

A shop owner has to be able to run this alone, on a Sunday, without calling
anyone. That means editing a staff member's details, resetting the password
they have forgotten, and removing someone who has left.

Two of those are dangerous in ways that are not obvious from the screen, and
the tests below are mostly about those:

  - Resetting a password must sign the person out everywhere. Otherwise
    revoking access leaves them working on the terminal they are already
    logged in to.
  - The new password must never reach the audit log, which many people can
    read and nothing ever purges.
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy import select

from app.db.models.audit import AuditLog
from app.db.session import session_scope
from tests._helpers import auth, elevate, login


async def _staff(client: AsyncClient, h: dict, **over) -> dict:
    body = {
        "email": "cashier@example.com",
        "full_name": "Counter Staff",
        "role": "cashier",
        "password": "counter-password-1",
        "phone": "9876500001",
        **over,
    }
    r = await client.post("/api/v1/users", headers=h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Create + read
# ---------------------------------------------------------------------------


async def test_a_staff_code_is_issued_automatically(client: AsyncClient) -> None:
    """The code goes on a name badge; nobody should have to invent one."""
    h = auth(await login(client))
    staff = await _staff(client, h)
    assert staff["staff_code"], "a code was issued"
    assert staff["staff_code"].startswith("STF-")


async def test_staff_appear_in_the_directory(client: AsyncClient) -> None:
    h = auth(await login(client))
    await _staff(client, h)
    r = await client.get("/api/v1/users", headers=h)
    assert r.status_code == 200, r.text
    assert any(u["email"] == "cashier@example.com" for u in r.json()["items"])


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------


async def test_details_can_be_edited(client: AsyncClient) -> None:
    h = auth(await login(client))
    staff = await _staff(client, h)

    r = await client.patch(f"/api/v1/users/{staff['id']}", headers=h, json={
        "full_name": "Counter Staff Senior",
        "phone": "9998887777",
        "role": "manager",
        "commission_pct": "2.50",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["full_name"] == "Counter Staff Senior"
    assert body["phone"] == "9998887777"
    assert body["role"] == "manager"
    assert Decimal(body["commission_pct"]) == Decimal("2.50")


async def test_a_staff_code_cannot_be_taken_from_someone_else(
    client: AsyncClient,
) -> None:
    """Two people sharing a code would credit the wrong person's commission."""
    h = auth(await login(client))
    first = await _staff(client, h)
    second = await _staff(client, h, email="second@example.com")

    r = await client.patch(f"/api/v1/users/{second['id']}", headers=h,
                           json={"staff_code": first["staff_code"]})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "STAFF_CODE_TAKEN"


async def test_deactivating_keeps_the_person_and_their_history(
    client: AsyncClient,
) -> None:
    """The safe alternative to deleting. Nothing is lost."""
    h = auth(await login(client))
    staff = await _staff(client, h)

    r = await client.patch(f"/api/v1/users/{staff['id']}", headers=h,
                           json={"is_active": False})
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is False

    r = await client.get(f"/api/v1/users/{staff['id']}", headers=h)
    assert r.status_code == 200, "still there, just switched off"


# ---------------------------------------------------------------------------
# Password reset — the part with sharp edges
# ---------------------------------------------------------------------------


async def test_an_owner_can_reset_a_forgotten_password(client: AsyncClient) -> None:
    h = auth(await login(client))
    staff = await _staff(client, h)

    r = await client.patch(f"/api/v1/users/{staff['id']}", headers=h,
                           json={"password": "brand-new-password-9"})
    assert r.status_code == 200, r.text

    r = await client.post("/api/v1/auth/login", json={
        "email": "cashier@example.com", "password": "brand-new-password-9"})
    assert r.status_code == 200, r.text

    r = await client.post("/api/v1/auth/login", json={
        "email": "cashier@example.com", "password": "counter-password-1"})
    assert r.status_code == 401, "the old password is dead"


async def test_a_reset_signs_the_person_out_everywhere(client: AsyncClient) -> None:
    """Otherwise taking someone's access away leaves them working on the
    terminal they are already signed in to."""
    h = auth(await login(client))
    staff = await _staff(client, h)

    r = await client.post("/api/v1/auth/login", json={
        "email": "cashier@example.com", "password": "counter-password-1"})
    their_refresh = r.json()["tokens"]["refresh_token"]

    await client.patch(f"/api/v1/users/{staff['id']}", headers=h,
                       json={"password": "brand-new-password-9"})

    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": their_refresh})
    assert r.status_code == 401, "the old session cannot renew itself"


async def test_the_new_password_never_reaches_the_audit_log(
    client: AsyncClient,
) -> None:
    """`model_dump()` would write it in plaintext to a table many people read
    and nothing ever purges."""
    h = auth(await login(client))
    staff = await _staff(client, h)

    await client.patch(f"/api/v1/users/{staff['id']}", headers=h,
                       json={"password": "brand-new-password-9", "phone": "9000000000"})

    async with session_scope() as db:
        rows = (await db.execute(
            select(AuditLog).where(AuditLog.action == "user.update")
        )).scalars().all()

    assert rows, "the edit was audited"
    blob = str([r.changes for r in rows])
    assert "brand-new-password-9" not in blob, "plaintext password leaked"
    assert "***" in blob, "the field is recorded as redacted, not dropped"
    assert "9000000000" in blob, "the other fields are still auditable"


async def test_a_short_password_is_refused(client: AsyncClient) -> None:
    h = auth(await login(client))
    staff = await _staff(client, h)
    r = await client.patch(f"/api/v1/users/{staff['id']}", headers=h,
                           json={"password": "short"})
    assert r.status_code == 422, r.text


async def test_an_edit_without_a_password_leaves_it_alone(client: AsyncClient) -> None:
    """Editing a phone number must not invalidate the person's login."""
    h = auth(await login(client))
    staff = await _staff(client, h)

    await client.patch(f"/api/v1/users/{staff['id']}", headers=h,
                       json={"phone": "9111111111"})

    r = await client.post("/api/v1/auth/login", json={
        "email": "cashier@example.com", "password": "counter-password-1"})
    assert r.status_code == 200, "the original password still works"


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


async def test_deleting_staff_needs_a_password_confirmation(
    client: AsyncClient,
) -> None:
    h = auth(await login(client))
    staff = await _staff(client, h)

    r = await client.delete(f"/api/v1/users/{staff['id']}", headers=h)
    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "ELEVATION_REQUIRED"

    r = await client.get(f"/api/v1/users/{staff['id']}", headers=h)
    assert r.status_code == 200, "still there"


async def test_a_confirmed_delete_removes_them(client: AsyncClient) -> None:
    token = await login(client)
    h = auth(token)
    staff = await _staff(client, h)

    r = await client.delete(f"/api/v1/users/{staff['id']}",
                            headers=await elevate(client, token))
    assert r.status_code == 204, r.text

    r = await client.get(f"/api/v1/users/{staff['id']}", headers=h)
    assert r.status_code == 404


async def test_deleting_staff_keeps_the_bills_but_loses_the_attribution(
    client: AsyncClient,
) -> None:
    """The consequence the screen has to spell out.

    `sales.salesperson_user_id` is ON DELETE SET NULL, so the bills survive and
    the money is untouched — but who sold them is gone for good, and with it
    the basis for any commission recalculation. This is why the directory
    steers towards deactivating instead.
    """
    token = await login(client)
    h = auth(token)
    staff = await _staff(client, h)

    r = await client.post("/api/v1/stores", headers=h,
                          json={"code": "SD", "name": "Staff Store"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Kurta", "unit_id": unit_id, "tax_rate": "5.00",
        "variants": [{"name": "Default", "sku": "SD-1", "cost_price": "400.00",
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
        "salesperson_user_id": staff["id"],
        "lines": [{"variant_id": variant_id, "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "899.00"}]})
    assert r.status_code == 201, r.text
    sale_id = r.json()["id"]
    assert r.json()["salesperson_user_id"] == staff["id"]

    r = await client.delete(f"/api/v1/users/{staff['id']}",
                            headers=await elevate(client, token))
    assert r.status_code == 204, r.text

    r = await client.get(f"/api/v1/sales/{sale_id}", headers=h)
    assert r.status_code == 200, "the bill survives"
    assert Decimal(r.json()["grand_total"]) == Decimal("899.00"), "the money is untouched"
    assert r.json()["salesperson_user_id"] is None, "but who sold it is gone"
