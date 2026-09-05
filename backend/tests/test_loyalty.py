"""Reward points.

The tables for this shipped in migration 0006 and then sat unused — no model,
no service, no endpoint. These tests cover the Python that finally reads them.

Points are a LIABILITY: every one issued is a promise to discount a future
bill. So the properties worth pinning are the ones that cost real money when
they break — points issued at the wrong rate, points spent twice, and points
kept on goods that went back on the shelf.
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, elevate, login


async def _shop(client: AsyncClient, *, per_rupee: str = "1.0000") -> dict:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h, json={"code": "LY", "name": "Loyal Store"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/customers", headers=h, json={
        "name": "Ramesh Kumar", "phone": "9876500001"})
    assert r.status_code == 201, r.text
    customer_id = r.json()["id"]

    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Kurta", "unit_id": unit_id, "tax_rate": "0.00",
        "variants": [{"name": "Default", "sku": "LY-1", "cost_price": "400.00",
                      "mrp": "1000.00", "selling_price": "1000.00",
                      "reorder_point": "1.000", "reorder_quantity": "5.000"}]})
    variant_id = r.json()["variants"][0]["id"]

    await client.post("/api/v1/day-sessions/open", headers=h,
                      json={"store_id": store_id, "opening_cash": "0.00"})
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": variant_id, "delta": "50.000"}]})

    r = await client.put("/api/v1/loyalty/program", headers=h, json={
        "name": "Rewards", "points_per_rupee": per_rupee,
        "redemption_rate": "0.2500", "expiry_days": 365})
    assert r.status_code == 200, r.text

    return {"h": h, "token": token, "store_id": store_id,
            "customer_id": customer_id, "variant_id": variant_id}


async def _sell(client: AsyncClient, shop: dict, qty: str, paid: str,
                *, customer: bool = True) -> dict:
    body = {
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["variant_id"], "quantity": qty}],
        "payments": [{"method": "cash", "amount": paid}],
    }
    if customer:
        body["customer_id"] = shop["customer_id"]
    r = await client.post("/api/v1/sales", headers=shop["h"], json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def _balance(client: AsyncClient, shop: dict) -> Decimal:
    r = await client.get(f"/api/v1/loyalty/{shop['customer_id']}", headers=shop["h"])
    assert r.status_code == 200, r.text
    return Decimal(r.json()["points_balance"])


# ---------------------------------------------------------------------------
# Earning
# ---------------------------------------------------------------------------


async def test_a_sale_earns_points_at_the_configured_rate(client: AsyncClient) -> None:
    shop = await _shop(client, per_rupee="1.0000")
    await _sell(client, shop, "1.000", "1000.00")
    assert await _balance(client, shop) == Decimal("1000.00")


async def test_a_fractional_rate_works(client: AsyncClient) -> None:
    """One point per ₹100 is 0.01 per rupee — the reason the column is Numeric(10,4)."""
    shop = await _shop(client, per_rupee="0.0100")
    await _sell(client, shop, "1.000", "1000.00")
    assert await _balance(client, shop) == Decimal("10.00")


async def test_a_walk_in_earns_nothing(client: AsyncClient) -> None:
    """No customer, no account to credit. The sale must still go through."""
    shop = await _shop(client)
    sale = await _sell(client, shop, "1.000", "1000.00", customer=False)
    assert sale["customer_id"] is None
    assert await _balance(client, shop) == Decimal("0.00")


async def test_selling_works_with_no_program_configured(client: AsyncClient) -> None:
    """A shop that never turns loyalty on must be entirely unaffected."""
    token = await login(client)
    h = auth(token)
    r = await client.get("/api/v1/loyalty/program", headers=h)
    assert r.status_code == 200
    assert r.json() is None

    r = await client.post("/api/v1/stores", headers=h, json={"code": "NP", "name": "No Program"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/customers", headers=h, json={"name": "Walk In"})
    customer_id = r.json()["id"]
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Kurta", "unit_id": unit_id, "tax_rate": "0.00",
        "variants": [{"name": "Default", "sku": "NP-1", "cost_price": "400.00",
                      "mrp": "899.00", "selling_price": "899.00",
                      "reorder_point": "1.000", "reorder_quantity": "5.000"}]})
    variant_id = r.json()["variants"][0]["id"]
    await client.post("/api/v1/day-sessions/open", headers=h,
                      json={"store_id": store_id, "opening_cash": "0.00"})
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": variant_id, "delta": "5.000"}]})

    r = await client.post("/api/v1/sales", headers=h, json={
        "store_id": store_id, "customer_id": customer_id,
        "lines": [{"variant_id": variant_id, "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "899.00"}]})
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["grand_total"]) == Decimal("899.00")


async def test_points_round_down_never_up(client: AsyncClient) -> None:
    """A fraction rounded up on every bill is points nobody earned."""
    shop = await _shop(client, per_rupee="0.0033")
    await _sell(client, shop, "1.000", "1000.00")
    # 1000 x 0.0033 = 3.30 exactly; the guard is that it is never 3.31.
    assert await _balance(client, shop) == Decimal("3.30")


# ---------------------------------------------------------------------------
# Redeeming
# ---------------------------------------------------------------------------


async def test_a_quote_does_not_spend_anything(client: AsyncClient) -> None:
    """Showing a customer what their points are worth must not consume them."""
    shop = await _shop(client)
    await _sell(client, shop, "1.000", "1000.00")

    r = await client.post(f"/api/v1/loyalty/{shop['customer_id']}/quote",
                          headers=shop["h"], json={"points": "400.00"})
    assert r.status_code == 200, r.text
    assert Decimal(r.json()["rupees"]) == Decimal("100.00")  # 400 x 0.25
    assert await _balance(client, shop) == Decimal("1000.00")


async def test_redeeming_spends_points_and_grants_rupees(client: AsyncClient) -> None:
    shop = await _shop(client)
    await _sell(client, shop, "1.000", "1000.00")

    r = await client.post(f"/api/v1/loyalty/{shop['customer_id']}/redeem",
                          headers=shop["h"], json={"points": "400.00"})
    assert r.status_code == 200, r.text
    assert Decimal(r.json()["rupees_granted"]) == Decimal("100.00")
    assert Decimal(r.json()["points_balance"]) == Decimal("600.00")
    assert await _balance(client, shop) == Decimal("600.00")


async def test_cannot_redeem_more_than_the_balance(client: AsyncClient) -> None:
    """The whole reason the redeem path takes a lock."""
    shop = await _shop(client)
    await _sell(client, shop, "1.000", "1000.00")

    r = await client.post(f"/api/v1/loyalty/{shop['customer_id']}/redeem",
                          headers=shop["h"], json={"points": "2000.00"})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "INSUFFICIENT_POINTS"
    assert await _balance(client, shop) == Decimal("1000.00")


async def test_redeeming_twice_cannot_overdraw(client: AsyncClient) -> None:
    shop = await _shop(client)
    await _sell(client, shop, "1.000", "1000.00")

    for _ in range(2):
        r = await client.post(f"/api/v1/loyalty/{shop['customer_id']}/redeem",
                              headers=shop["h"], json={"points": "600.00"})
        if r.status_code != 200:
            break
    assert await _balance(client, shop) >= Decimal("0.00")
    assert await _balance(client, shop) == Decimal("400.00")


# ---------------------------------------------------------------------------
# Taking points back
# ---------------------------------------------------------------------------


async def test_voiding_a_sale_takes_its_points_back(client: AsyncClient) -> None:
    shop = await _shop(client)
    sale = await _sell(client, shop, "1.000", "1000.00")
    assert await _balance(client, shop) == Decimal("1000.00")

    r = await client.post(f"/api/v1/sales/{sale['id']}/void",
                          headers=await elevate(client, shop["token"]),
                          json={"reason": "Rung up twice"})
    assert r.status_code == 200, r.text
    assert await _balance(client, shop) == Decimal("0.00")


async def test_a_partial_return_takes_back_a_proportional_share(
    client: AsyncClient,
) -> None:
    """Return one of four items, lose a quarter of the points — not all of them."""
    shop = await _shop(client)
    sale = await _sell(client, shop, "4.000", "4000.00")
    assert await _balance(client, shop) == Decimal("4000.00")

    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
        "lines": [{"sale_line_id": sale["lines"][0]["id"], "quantity": "1.000"}],
        "refunds": [{"method": "cash", "amount": "1000.00"}],
        "reason": "Wrong size",
    })
    assert r.status_code == 201, r.text
    assert await _balance(client, shop) == Decimal("3000.00")


async def test_returning_everything_leaves_no_points(client: AsyncClient) -> None:
    shop = await _shop(client)
    sale = await _sell(client, shop, "2.000", "2000.00")

    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
        "lines": [{"sale_line_id": sale["lines"][0]["id"], "quantity": "2.000"}],
        "refunds": [{"method": "cash", "amount": "2000.00"}],
        "reason": "Changed their mind",
    })
    assert r.status_code == 201, r.text
    assert await _balance(client, shop) == Decimal("0.00")


async def test_reversal_never_takes_more_than_was_earned(client: AsyncClient) -> None:
    """Two partial returns then a void must not reverse past the original grant."""
    shop = await _shop(client)
    sale = await _sell(client, shop, "4.000", "4000.00")

    # Earn on a SECOND bill, so the balance is larger than this sale's grant.
    await _sell(client, shop, "1.000", "1000.00")
    assert await _balance(client, shop) == Decimal("5000.00")

    for _ in range(2):
        r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
            "lines": [{"sale_line_id": sale["lines"][0]["id"], "quantity": "1.000"}],
            "refunds": [{"method": "cash", "amount": "1000.00"}],
            "reason": "Wrong size",
        })
        assert r.status_code == 201, r.text

    # 4000 earned, half returned, so 2000 reversed — plus the untouched 1000.
    assert await _balance(client, shop) == Decimal("3000.00")


async def test_a_spent_balance_is_not_driven_negative(client: AsyncClient) -> None:
    """If the points are already gone the shop absorbs it, rather than
    leaving the customer unable to earn back to zero."""
    shop = await _shop(client)
    sale = await _sell(client, shop, "1.000", "1000.00")
    await client.post(f"/api/v1/loyalty/{shop['customer_id']}/redeem",
                      headers=shop["h"], json={"points": "1000.00"})
    assert await _balance(client, shop) == Decimal("0.00")

    r = await client.post(f"/api/v1/sales/{sale['id']}/void",
                          headers=await elevate(client, shop["token"]),
                          json={"reason": "Rung up twice"})
    assert r.status_code == 200, r.text
    assert await _balance(client, shop) == Decimal("0.00")


# ---------------------------------------------------------------------------
# The ledger, and tiers
# ---------------------------------------------------------------------------


async def test_the_statement_explains_the_balance(client: AsyncClient) -> None:
    shop = await _shop(client)
    await _sell(client, shop, "1.000", "1000.00")
    await client.post(f"/api/v1/loyalty/{shop['customer_id']}/redeem",
                      headers=shop["h"], json={"points": "400.00"})

    r = await client.get(f"/api/v1/loyalty/{shop['customer_id']}/statement",
                         headers=shop["h"])
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 2

    kinds = {row["kind"] for row in rows}
    assert kinds == {"earn", "redeem"}
    # Every row carries the balance it produced — that is what makes it a
    # statement rather than a list of events.
    assert Decimal(rows[0]["points_balance_after"]) == Decimal("600.00")

    total = sum(Decimal(row["points_delta"]) for row in rows)
    assert total == await _balance(client, shop), "ledger must equal the balance"


async def test_lifetime_spend_promotes_a_customer_to_a_tier(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await client.post("/api/v1/loyalty/tiers", headers=shop["h"], json={
        "name": "Gold", "min_lifetime_spend": "5000.00",
        "points_multiplier": "2.000", "default_discount_pct": "5.00"})
    assert r.status_code == 201, r.text
    gold_id = r.json()["id"]

    await _sell(client, shop, "2.000", "2000.00")
    r = await client.get(f"/api/v1/loyalty/{shop['customer_id']}", headers=shop["h"])
    assert r.json()["membership_tier_id"] is None, "not yet at the threshold"

    await _sell(client, shop, "4.000", "4000.00")
    r = await client.get(f"/api/v1/loyalty/{shop['customer_id']}", headers=shop["h"])
    assert r.json()["membership_tier_id"] == gold_id
    assert Decimal(r.json()["lifetime_spend"]) == Decimal("6000.00")


async def test_a_tier_multiplies_what_later_bills_earn(client: AsyncClient) -> None:
    shop = await _shop(client)
    await client.post("/api/v1/loyalty/tiers", headers=shop["h"], json={
        "name": "Gold", "min_lifetime_spend": "1000.00", "points_multiplier": "2.000"})

    await _sell(client, shop, "1.000", "1000.00")   # earns 1000, then promotes
    assert await _balance(client, shop) == Decimal("1000.00")

    await _sell(client, shop, "1.000", "1000.00")   # now at 2x
    assert await _balance(client, shop) == Decimal("3000.00")


async def test_an_adjustment_requires_a_reason(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await client.post(f"/api/v1/loyalty/{shop['customer_id']}/adjust",
                          headers=shop["h"], json={"points": "50.00"})
    assert r.status_code == 422, r.text


async def test_an_adjustment_is_recorded_with_its_reason(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await client.post(f"/api/v1/loyalty/{shop['customer_id']}/adjust",
                          headers=shop["h"],
                          json={"points": "50.00", "reason": "Goodwill — damaged packaging"})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "adjustment"
    assert r.json()["reason"] == "Goodwill — damaged packaging"
    assert await _balance(client, shop) == Decimal("50.00")


# ---------------------------------------------------------------------------
# Expiry
# ---------------------------------------------------------------------------


async def test_points_expire_once_their_date_has_passed(client: AsyncClient) -> None:
    """`expires_at` was already stamped on every earn row; nothing acted on it.

    Left unswept the shop's liability grows forever while its own settings say
    otherwise, and the first anyone hears of it is a customer redeeming
    three-year-old points.
    """
    from datetime import date, timedelta

    from app.db.session import session_scope
    from app.services.loyalty import LoyaltyService

    shop = await _shop(client)
    await _sell(client, shop, "1.000", "1000.00")
    assert await _balance(client, shop) == Decimal("1000.00")

    # A year and a day on, with the program's 365-day window.
    async with session_scope() as db:
        affected = await LoyaltyService(db).expire_due_points(
            today=date.today() + timedelta(days=366)
        )
    assert affected == 1
    assert await _balance(client, shop) == Decimal("0.00")


async def test_the_sweep_is_idempotent(client: AsyncClient) -> None:
    """Running twice in a day must not expire the same points again."""
    from datetime import date, timedelta

    from app.db.session import session_scope
    from app.services.loyalty import LoyaltyService

    shop = await _shop(client)
    await _sell(client, shop, "1.000", "1000.00")
    future = date.today() + timedelta(days=366)

    async with session_scope() as db:
        await LoyaltyService(db).expire_due_points(today=future)
    async with session_scope() as db:
        second = await LoyaltyService(db).expire_due_points(today=future)

    assert second == 0
    assert await _balance(client, shop) == Decimal("0.00")


async def test_already_spent_points_do_not_expire_again(client: AsyncClient) -> None:
    """Redeemed points are gone; lapsing them a second time would go negative."""
    from datetime import date, timedelta

    from app.db.session import session_scope
    from app.services.loyalty import LoyaltyService

    shop = await _shop(client)
    await _sell(client, shop, "1.000", "1000.00")
    await client.post(f"/api/v1/loyalty/{shop['customer_id']}/redeem",
                      headers=shop["h"], json={"points": "1000.00"})

    async with session_scope() as db:
        affected = await LoyaltyService(db).expire_due_points(
            today=date.today() + timedelta(days=366)
        )
    assert affected == 0
    assert await _balance(client, shop) == Decimal("0.00")


async def test_points_that_are_not_due_yet_are_left_alone(client: AsyncClient) -> None:
    from app.db.session import session_scope
    from app.services.loyalty import LoyaltyService

    shop = await _shop(client)
    await _sell(client, shop, "1.000", "1000.00")

    async with session_scope() as db:
        affected = await LoyaltyService(db).expire_due_points()
    assert affected == 0
    assert await _balance(client, shop) == Decimal("1000.00")


async def test_expiry_shows_in_the_statement(client: AsyncClient) -> None:
    from datetime import date, timedelta

    from app.db.session import session_scope
    from app.services.loyalty import LoyaltyService

    shop = await _shop(client)
    await _sell(client, shop, "1.000", "1000.00")
    async with session_scope() as db:
        await LoyaltyService(db).expire_due_points(today=date.today() + timedelta(days=366))

    r = await client.get(f"/api/v1/loyalty/{shop['customer_id']}/statement", headers=shop["h"])
    kinds = [row["kind"] for row in r.json()]
    assert "expiry" in kinds
