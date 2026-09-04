"""Advances received — money in before goods go out.

An advance is stored as a `sales` row with NO lines, grand_total 0, and a
NEGATIVE balance_due. That shape is what keeps every existing aggregate correct
without touching it:

  - revenue sums grand_total, which is 0, so an advance is not a sale
  - the shift's expected cash sums payments, which are positive, so the money
    in the drawer is accounted for
  - the credit-limit check sums balance_due, so an advance REDUCES what the
    customer may owe
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login


async def _shop(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)
    r = await client.post("/api/v1/stores", headers=h, json={"code": "AD", "name": "Advance Store"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Saree", "unit_id": unit_id, "tax_rate": "5.00",
        "variants": [{"name": "Default", "sku": "SAR-1", "cost_price": "2000.00",
                      "mrp": "5000.00", "selling_price": "5000.00",
                      "reorder_point": "1.000", "reorder_quantity": "5.000"}]})
    variant_id = r.json()["variants"][0]["id"]
    r = await client.post("/api/v1/day-sessions/open", headers=h,
                          json={"store_id": store_id, "opening_cash": "1000.00"})
    session_id = r.json()["id"]
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": variant_id, "delta": "20.000"}]})
    r = await client.post("/api/v1/customers", headers=h, json={"name": "Wedding Party"})
    return {"h": h, "store_id": store_id, "variant_id": variant_id,
            "session_id": session_id, "customer_id": r.json()["id"]}


async def _advance(client: AsyncClient, shop: dict, amount: str, method: str = "cash"):
    return await client.post("/api/v1/sales/advances", headers=shop["h"], json={
        "store_id": shop["store_id"], "customer_id": shop["customer_id"],
        "payments": [{"method": method, "amount": amount}],
        "notes": "Wedding order deposit",
    })


async def test_an_advance_is_recorded_but_is_not_revenue(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await _advance(client, shop, "5000.00")
    assert r.status_code == 201, r.text
    adv = r.json()

    assert adv["doc_type"] == "advance"
    assert adv["lines"] == []
    # Nothing delivered, so nothing sold.
    assert Decimal(adv["grand_total"]) == Decimal("0.00")
    assert Decimal(adv["paid_total"]) == Decimal("5000.00")
    # Negative: the shop owes the customer goods.
    assert Decimal(adv["balance_due"]) == Decimal("-5000.00")
    assert adv["number"].startswith("ADV-AD-"), adv["number"]


async def test_advance_cash_reaches_the_till(client: AsyncClient) -> None:
    """The money is physically in the drawer, so the shift must expect it."""
    shop = await _shop(client)
    r = await client.get(f"/api/v1/day-sessions/{shop['session_id']}/summary", headers=shop["h"])
    assert Decimal(r.json()["expected_cash"]) == Decimal("1000.00")

    assert (await _advance(client, shop, "5000.00")).status_code == 201

    r = await client.get(f"/api/v1/day-sessions/{shop['session_id']}/summary", headers=shop["h"])
    assert Decimal(r.json()["expected_cash"]) == Decimal("6000.00")


async def test_advance_reduces_what_the_customer_may_owe(client: AsyncClient) -> None:
    """A customer holding credit should be able to buy beyond their limit by
    exactly that much — the shop is already holding their money."""
    shop = await _shop(client)
    r = await client.post("/api/v1/customers", headers=shop["h"], json={
        "name": "Prepaid", "credit_limit": "1000.00"})
    customer_id = r.json()["id"]
    shop = {**shop, "customer_id": customer_id}

    # 5,000 of goods on credit against a 1,000 limit — refused.
    async def credit_sale():
        return await client.post("/api/v1/sales", headers=shop["h"], json={
            "store_id": shop["store_id"], "customer_id": customer_id,
            "lines": [{"variant_id": shop["variant_id"], "quantity": "1.000"}],
            "payments": []})

    assert (await credit_sale()).status_code == 422

    # Take a 5,000 advance, and the same sale now fits.
    assert (await _advance(client, shop, "5000.00")).status_code == 201
    assert (await credit_sale()).status_code == 201


async def test_customer_balance_splits_owed_from_held(client: AsyncClient) -> None:
    shop = await _shop(client)
    assert (await _advance(client, shop, "3000.00")).status_code == 201

    r = await client.get(
        f"/api/v1/sales/customers/{shop['customer_id']}/balance", headers=shop["h"]
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert Decimal(body["advance_held"]) == Decimal("3000.00")
    assert Decimal(body["owed_by_customer"]) == Decimal("0.00")
    # Negative net = the shop holds their money.
    assert Decimal(body["net_balance"]) == Decimal("-3000.00")


async def test_an_advance_requires_a_customer(client: AsyncClient) -> None:
    """Money held against nobody can neither be applied nor refunded."""
    shop = await _shop(client)
    r = await client.post("/api/v1/sales/advances", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "payments": [{"method": "cash", "amount": "1000.00"}]})
    assert r.status_code == 422, r.text


async def test_an_advance_requires_a_payment(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await client.post("/api/v1/sales/advances", headers=shop["h"], json={
        "store_id": shop["store_id"], "customer_id": shop["customer_id"],
        "payments": []})
    assert r.status_code == 422, r.text


async def test_advances_carry_their_own_serial_series(client: AsyncClient) -> None:
    shop = await _shop(client)
    r1 = await _advance(client, shop, "100.00")
    r2 = await _advance(client, shop, "200.00")
    assert r1.json()["number"].endswith("0001")
    assert r2.json()["number"].endswith("0002")

    # A normal sale keeps the INV series, untouched by the advance counter.
    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["variant_id"], "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "5000.00"}]})
    assert r.status_code == 201, r.text
    assert r.json()["number"].startswith("INV-AD-")
    assert r.json()["number"].endswith("0001")


async def test_an_advance_is_idempotent(client: AsyncClient) -> None:
    """A terminal retrying an advance must not take the money twice."""
    shop = await _shop(client)
    body = {
        "store_id": shop["store_id"], "customer_id": shop["customer_id"],
        "payments": [{"method": "cash", "amount": "2500.00"}],
        "client_uuid": "advance-retry-1",
    }
    r1 = await client.post("/api/v1/sales/advances", headers=shop["h"], json=body)
    r2 = await client.post("/api/v1/sales/advances", headers=shop["h"], json=body)
    assert r1.status_code == 201, r1.text
    assert r2.status_code == 201, r2.text
    assert r1.json()["id"] == r2.json()["id"], "a retry must return the same advance"

    r = await client.get(
        f"/api/v1/sales/customers/{shop['customer_id']}/balance", headers=shop["h"]
    )
    assert Decimal(r.json()["advance_held"]) == Decimal("2500.00"), "not doubled"
