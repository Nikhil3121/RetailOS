"""Four things the counter needs that the counter did not have.

HELD BILLS lived in `localStorage`, which means they lived in ONE BROWSER. Two
tills at the same mall could not see each other's parked carts, so a customer
who stepped away at counter 1 could not be finished at counter 2.

SALESPERSON PER LINE — the bill credited one person for everything, and in a
garment shop two staff routinely split a sale. Commission is computed from it.

LOYALTY REDEMPTION could record points as spent and could not reduce the bill
they were spent on, because there was no bill-level discount to put it in.

REPRINTS were indistinguishable from originals, which is how one invoice gets
paid twice.
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login


async def _shop(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h, json={"code": "CO", "name": "Counter Mall"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/customers", headers=h, json={
        "name": "Ramesh", "phone": "9876500055"})
    customer_id = r.json()["id"]
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Saree", "unit_id": unit_id, "tax_rate": "0.00",
        "variants": [{"name": "Default", "sku": "CO-1", "cost_price": "400.00",
                      "mrp": "1000.00", "selling_price": "1000.00",
                      "reorder_point": "1.000", "reorder_quantity": "5.000"}]})
    variant_id = r.json()["variants"][0]["id"]

    await client.post("/api/v1/day-sessions/open", headers=h,
                      json={"store_id": store_id, "opening_cash": "0.00"})
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": variant_id, "delta": "100.000"}]})

    return {"h": h, "token": token, "store_id": store_id,
            "customer_id": customer_id, "variant_id": variant_id}


# ---------------------------------------------------------------------------
# Held bills
# ---------------------------------------------------------------------------


async def test_a_parked_cart_is_visible_to_the_other_till(
    client: AsyncClient,
) -> None:
    """The whole reason this moved off localStorage."""
    shop = await _shop(client)

    r = await client.post("/api/v1/held-bills", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "label": "Blue saree lady",
        "cart": {"lines": [{"variant_id": shop["variant_id"], "quantity": "2"}]},
        "terminal_uuid": "COUNTER-1",
    })
    assert r.status_code == 201, r.text

    # A different till, same branch, asks what is parked.
    r = await client.get(f"/api/v1/held-bills?store_id={shop['store_id']}",
                         headers=shop["h"])
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1
    assert r.json()[0]["label"] == "Blue saree lady"
    assert r.json()[0]["cart"]["lines"][0]["quantity"] == "2"


async def test_a_parked_cart_belongs_to_its_branch_only(
    client: AsyncClient,
) -> None:
    """MS1's parked bills must not appear at MS2."""
    shop = await _shop(client)
    r = await client.post("/api/v1/stores", headers=shop["h"],
                          json={"code": "OT", "name": "Other Mall"})
    other = r.json()["id"]

    await client.post("/api/v1/held-bills", headers=shop["h"], json={
        "store_id": shop["store_id"], "cart": {"lines": []}})

    r = await client.get(f"/api/v1/held-bills?store_id={other}", headers=shop["h"])
    assert r.json() == []


async def test_a_parked_cart_can_be_discarded(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await client.post("/api/v1/held-bills", headers=shop["h"], json={
        "store_id": shop["store_id"], "cart": {"lines": []}})
    held_id = r.json()["id"]

    r = await client.delete(f"/api/v1/held-bills/{held_id}", headers=shop["h"])
    assert r.status_code == 204, r.text

    r = await client.get(f"/api/v1/held-bills?store_id={shop['store_id']}",
                         headers=shop["h"])
    assert r.json() == []


async def test_discarding_a_cart_that_is_already_gone_says_so(
    client: AsyncClient,
) -> None:
    """Two tills can resume the same parked bill at the same moment."""
    shop = await _shop(client)
    r = await client.delete(
        "/api/v1/held-bills/11111111-1111-4111-8111-111111111111",
        headers=shop["h"])
    assert r.status_code == 404, r.text


async def test_a_held_bill_is_not_a_sale(client: AsyncClient) -> None:
    """It has no number, no stock movement and no money — and must not appear
    in any revenue query."""
    shop = await _shop(client)
    await client.post("/api/v1/held-bills", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "cart": {"lines": [{"variant_id": shop["variant_id"], "quantity": "5"}]}})

    r = await client.get("/api/v1/sales", headers=shop["h"])
    assert r.json()["total"] == 0

    r = await client.get(f"/api/v1/inventory/levels?store_id={shop['store_id']}",
                         headers=shop["h"])
    row = next(x for x in r.json()["items"] if x["variant_id"] == shop["variant_id"])
    assert Decimal(row["quantity"]) == Decimal("100.000"), "no stock moved"


# ---------------------------------------------------------------------------
# Salesperson per line
# ---------------------------------------------------------------------------


async def _staff(client: AsyncClient, shop: dict, email: str) -> str:
    r = await client.post("/api/v1/users", headers=shop["h"], json={
        "email": email, "full_name": "Counter Staff", "role": "cashier",
        "password": "counter-password-1"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_two_staff_can_split_one_bill(client: AsyncClient) -> None:
    """A saree from her, the blouse from him. Commission depends on it."""
    shop = await _shop(client)
    a = await _staff(client, shop, "a@example.com")
    b = await _staff(client, shop, "b@example.com")

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "lines": [
            {"variant_id": shop["variant_id"], "quantity": "1.000",
             "salesperson_user_id": a},
            {"variant_id": shop["variant_id"], "quantity": "1.000",
             "salesperson_user_id": b},
        ],
        "payments": [{"method": "cash", "amount": "2000.00"}]})
    assert r.status_code == 201, r.text
    credited = {ln["salesperson_user_id"] for ln in r.json()["lines"]}
    assert credited == {a, b}


async def test_a_line_falls_back_to_the_bill_salesperson(
    client: AsyncClient,
) -> None:
    """A simple sale must behave exactly as it always has."""
    shop = await _shop(client)
    a = await _staff(client, shop, "c@example.com")

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "salesperson_user_id": a,
        "lines": [{"variant_id": shop["variant_id"], "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "1000.00"}]})
    assert r.status_code == 201, r.text
    assert r.json()["lines"][0]["salesperson_user_id"] == a


async def test_a_bill_with_no_salesperson_at_all_still_works(
    client: AsyncClient,
) -> None:
    shop = await _shop(client)
    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["variant_id"], "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "1000.00"}]})
    assert r.status_code == 201, r.text
    assert r.json()["lines"][0]["salesperson_user_id"] is None


# ---------------------------------------------------------------------------
# Loyalty redeemed against the bill it paid for
# ---------------------------------------------------------------------------


async def _loyalty(client: AsyncClient, shop: dict) -> None:
    r = await client.put("/api/v1/loyalty/program", headers=shop["h"], json={
        "name": "Rewards", "points_per_rupee": "1.0000",
        "redemption_rate": "0.2500", "expiry_days": 365})
    assert r.status_code == 200, r.text


async def test_points_now_reduce_the_bill_they_are_spent_on(
    client: AsyncClient,
) -> None:
    """Until the bill-level discount existed, redeeming could take the points
    and had nowhere to put the money."""
    shop = await _shop(client)
    await _loyalty(client, shop)

    # Earn 1,000 points on a first bill.
    await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"], "customer_id": shop["customer_id"],
        "lines": [{"variant_id": shop["variant_id"], "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "1000.00"}]})

    # Spend 400 of them on the next. 400 x 0.25 = ₹100 off.
    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"], "customer_id": shop["customer_id"],
        "redeem_points": "400.00",
        "lines": [{"variant_id": shop["variant_id"], "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "900.00"}]})
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["bill_discount"]) == Decimal("100.00")
    assert Decimal(r.json()["grand_total"]) == Decimal("900.00")

    # And the points really left the account.
    r = await client.get(f"/api/v1/loyalty/{shop['customer_id']}", headers=shop["h"])
    # 1000 earned, 400 spent, plus what the second bill earned on ₹900.
    assert Decimal(r.json()["points_balance"]) == Decimal("1500.00")


async def test_redeeming_needs_a_named_customer(client: AsyncClient) -> None:
    shop = await _shop(client)
    await _loyalty(client, shop)
    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "redeem_points": "100.00",
        "lines": [{"variant_id": shop["variant_id"], "quantity": "1.000"}],
        "payments": []})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "REDEEM_WITHOUT_CUSTOMER"


async def test_redeeming_more_than_the_bill_is_worth_is_refused(
    client: AsyncClient,
) -> None:
    """And the points must not be taken by the attempt."""
    shop = await _shop(client)
    await _loyalty(client, shop)
    await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"], "customer_id": shop["customer_id"],
        "lines": [{"variant_id": shop["variant_id"], "quantity": "10.000"}],
        "payments": [{"method": "cash", "amount": "10000.00"}]})

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"], "customer_id": shop["customer_id"],
        "redeem_points": "8000.00",
        "lines": [{"variant_id": shop["variant_id"], "quantity": "1.000"}],
        "payments": []})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "REDEEM_EXCEEDS_TOTAL"

    r = await client.get(f"/api/v1/loyalty/{shop['customer_id']}", headers=shop["h"])
    assert Decimal(r.json()["points_balance"]) == Decimal("10000.00"), \
        "the failed attempt took no points"


# ---------------------------------------------------------------------------
# Reprints
# ---------------------------------------------------------------------------


async def test_a_reprint_is_countable(client: AsyncClient) -> None:
    """Two identical copies of one invoice is how a bill gets paid twice."""
    shop = await _shop(client)
    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["variant_id"], "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "1000.00"}]})
    sale_id = r.json()["id"]
    assert r.json()["print_count"] == 0

    r = await client.post(f"/api/v1/sales/{sale_id}/printed", headers=shop["h"])
    assert r.json()["print_count"] == 1, "the original"

    r = await client.post(f"/api/v1/sales/{sale_id}/printed", headers=shop["h"])
    assert r.json()["print_count"] == 2, "anything above 1 is a duplicate"
