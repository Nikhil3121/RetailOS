"""Customer credit limits.

The rule that matters: the limit is checked against the customer's TOTAL
outstanding, not just the bill in hand. A per-bill check would let someone run
up any amount one small credit sale at a time — precisely the failure a limit
exists to prevent.
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login


async def _shop(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)
    r = await client.post("/api/v1/stores", headers=h, json={"code": "CL", "name": "Credit Store"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Kurta", "unit_id": unit_id, "tax_rate": "5.00",
        "variants": [{"name": "Default", "sku": "K-1", "cost_price": "500.00",
                      "mrp": "1000.00", "selling_price": "1000.00",
                      "reorder_point": "1.000", "reorder_quantity": "5.000"}]})
    variant_id = r.json()["variants"][0]["id"]
    await client.post("/api/v1/day-sessions/open", headers=h,
                      json={"store_id": store_id, "opening_cash": "0.00"})
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": variant_id, "delta": "100.000"}]})
    return {"h": h, "store_id": store_id, "variant_id": variant_id}


async def _credit_sale(client: AsyncClient, shop: dict, customer_id: str, qty: str):
    return await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"], "customer_id": customer_id,
        "lines": [{"variant_id": shop["variant_id"], "quantity": qty}],
        "payments": [],  # nothing paid — the whole total becomes a due
    })


async def test_credit_sale_within_the_limit_is_allowed(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await client.post("/api/v1/customers", headers=shop["h"], json={
        "name": "Steady", "credit_limit": "5000.00"})
    assert r.status_code == 201, r.text
    customer_id = r.json()["id"]

    r = await _credit_sale(client, shop, customer_id, "3.000")
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["balance_due"]) == Decimal("3000.00")


async def test_a_single_bill_over_the_limit_is_refused(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await client.post("/api/v1/customers", headers=shop["h"], json={
        "name": "Overreach", "credit_limit": "2000.00"})
    customer_id = r.json()["id"]

    r = await _credit_sale(client, shop, customer_id, "3.000")
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "CREDIT_LIMIT_EXCEEDED"


async def test_limit_counts_every_open_bill_not_just_this_one(client: AsyncClient) -> None:
    """The assertion the whole feature rests on.

    Three bills of 1,000 against a 2,500 limit: the first two fit, the third
    must not. A per-bill check would wave all three through.
    """
    shop = await _shop(client)
    r = await client.post("/api/v1/customers", headers=shop["h"], json={
        "name": "Salami", "credit_limit": "2500.00"})
    customer_id = r.json()["id"]

    assert (await _credit_sale(client, shop, customer_id, "1.000")).status_code == 201
    assert (await _credit_sale(client, shop, customer_id, "1.000")).status_code == 201

    r = await _credit_sale(client, shop, customer_id, "1.000")
    assert r.status_code == 422, r.text
    body = r.json()["error"]
    assert body["code"] == "CREDIT_LIMIT_EXCEEDED"
    assert body["details"]["already_owed"] == "2000.00"


async def test_paying_down_frees_the_limit_again(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await client.post("/api/v1/customers", headers=shop["h"], json={
        "name": "Payer", "credit_limit": "2000.00"})
    customer_id = r.json()["id"]

    r = await _credit_sale(client, shop, customer_id, "2.000")
    assert r.status_code == 201, r.text
    sale_id = r.json()["id"]

    # At the ceiling — the next credit sale must fail.
    assert (await _credit_sale(client, shop, customer_id, "1.000")).status_code == 422

    r = await client.post(f"/api/v1/sales/{sale_id}/payments", headers=shop["h"],
                          json={"method": "cash", "amount": "2000.00"})
    assert r.status_code == 200, r.text

    # Settled, so the room is back.
    assert (await _credit_sale(client, shop, customer_id, "1.000")).status_code == 201


async def test_no_limit_means_no_limit(client: AsyncClient) -> None:
    """Every existing customer has NULL, and must be unaffected."""
    shop = await _shop(client)
    r = await client.post("/api/v1/customers", headers=shop["h"], json={"name": "Unlimited"})
    customer_id = r.json()["id"]
    r = await _credit_sale(client, shop, customer_id, "50.000")
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["balance_due"]) == Decimal("50000.00")


async def test_a_fully_paid_sale_never_touches_the_limit(client: AsyncClient) -> None:
    """A limit constrains CREDIT, not trade. Paying in full must always work."""
    shop = await _shop(client)
    r = await client.post("/api/v1/customers", headers=shop["h"], json={
        "name": "Cash Payer", "credit_limit": "100.00"})
    customer_id = r.json()["id"]

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"], "customer_id": customer_id,
        "lines": [{"variant_id": shop["variant_id"], "quantity": "5.000"}],
        "payments": [{"method": "cash", "amount": "5000.00"}],
    })
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["balance_due"]) == Decimal("0.00")
