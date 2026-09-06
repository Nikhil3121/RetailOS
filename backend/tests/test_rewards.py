"""Bill-value gift schemes — "spend ₹1,000, get a water bottle".

The gifts are bought in bulk outside the catalogue and are not SKUs, so nothing
here moves stock. The shop still has to know how many went out, and that comes
from the BILLS rather than from a counter — which is what these tests mostly
pin, along with the one property that matters more than any of it:

    WHAT THE SCREEN PROMISES AND WHAT THE BILL RECORDS MUST BE THE SAME.

The preview endpoint and the sale service call the same function for exactly
that reason. A customer promised a bottle on screen who does not get one on the
bill is the worst thing this feature could do.
"""

from __future__ import annotations

from datetime import timedelta

# The SHOP's calendar date, not the server's. A scheme's dates are typed by a
# person, and "today" has to mean the same thing on both sides of the
# assertion — otherwise this test passes or fails depending on what time of
# day it is run, which is exactly the bug it exists to catch.
from app.core.business_day import business_date
from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, elevate, login


async def _shop(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h, json={"code": "RW", "name": "Reward Mall"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Saree", "unit_id": unit_id, "tax_rate": "0.00",
        "variants": [{"name": "Default", "sku": "RW-1", "cost_price": "400.00",
                      "mrp": "1000.00", "selling_price": "1000.00",
                      "reorder_point": "1.000", "reorder_quantity": "5.000"}]})
    variant_id = r.json()["variants"][0]["id"]

    await client.post("/api/v1/day-sessions/open", headers=h,
                      json={"store_id": store_id, "opening_cash": "0.00"})
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": variant_id, "delta": "100.000"}]})

    return {"h": h, "token": token, "store_id": store_id, "variant_id": variant_id}


async def _scheme(client: AsyncClient, shop: dict, **over) -> dict:
    body = {"name": "Bottle offer", "min_bill_amount": "1000.00",
            "gift_label": "Water bottle", **over}
    r = await client.post("/api/v1/rewards", headers=shop["h"], json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def _ladder(client: AsyncClient, shop: dict) -> None:
    await _scheme(client, shop)
    await _scheme(client, shop, name="Glass offer",
                  min_bill_amount="2000.00", gift_label="Steel glass")


async def _sell(client: AsyncClient, shop: dict, qty: str, paid: str) -> dict:
    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["variant_id"], "quantity": qty}],
        "payments": [{"method": "cash", "amount": paid}]})
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Managing the ladder
# ---------------------------------------------------------------------------


async def test_a_scheme_can_be_created_and_read_back(client: AsyncClient) -> None:
    shop = await _shop(client)
    scheme = await _scheme(client, shop)
    assert scheme["gift_label"] == "Water bottle"
    assert Decimal(scheme["min_bill_amount"]) == Decimal("1000.00")

    r = await client.get(f"/api/v1/rewards/{scheme['id']}", headers=shop["h"])
    assert r.status_code == 200, r.text


async def test_schemes_list_cheapest_first(client: AsyncClient) -> None:
    """They read as a ladder, so they are ordered like one."""
    shop = await _shop(client)
    await _scheme(client, shop, name="Glass", min_bill_amount="2000.00",
                  gift_label="Steel glass")
    await _scheme(client, shop)

    r = await client.get("/api/v1/rewards", headers=shop["h"])
    amounts = [Decimal(s["min_bill_amount"]) for s in r.json()]
    assert amounts == sorted(amounts)


async def test_a_scheme_can_be_edited(client: AsyncClient) -> None:
    shop = await _shop(client)
    scheme = await _scheme(client, shop)

    r = await client.patch(f"/api/v1/rewards/{scheme['id']}", headers=shop["h"],
                           json={"gift_label": "Steel bottle", "min_bill_amount": "1500.00"})
    assert r.status_code == 200, r.text
    assert r.json()["gift_label"] == "Steel bottle"
    assert Decimal(r.json()["min_bill_amount"]) == Decimal("1500.00")


async def test_a_scheme_can_be_switched_off_without_deleting_it(
    client: AsyncClient,
) -> None:
    """A festival offer comes back next year. Switching off beats deleting."""
    shop = await _shop(client)
    scheme = await _scheme(client, shop)
    await client.patch(f"/api/v1/rewards/{scheme['id']}", headers=shop["h"],
                       json={"is_active": False})

    sale = await _sell(client, shop, "1.000", "1000.00")
    assert sale["reward_label"] is None

    r = await client.get("/api/v1/rewards?include_inactive=true", headers=shop["h"])
    assert len(r.json()) == 1, "still there, just off"


async def test_deleting_a_scheme_needs_a_password(client: AsyncClient) -> None:
    shop = await _shop(client)
    scheme = await _scheme(client, shop)

    r = await client.delete(f"/api/v1/rewards/{scheme['id']}", headers=shop["h"])
    assert r.status_code == 401, r.text

    r = await client.delete(f"/api/v1/rewards/{scheme['id']}",
                            headers=await elevate(client, shop["token"]))
    assert r.status_code == 204, r.text


async def test_a_scheme_ending_before_it_starts_is_refused(client: AsyncClient) -> None:
    """Otherwise a manager waits for an offer that can never fire."""
    shop = await _shop(client)
    r = await client.post("/api/v1/rewards", headers=shop["h"], json={
        "name": "Backwards", "min_bill_amount": "1000.00", "gift_label": "Bottle",
        "valid_from": "2027-11-15", "valid_to": "2027-11-01"})
    assert r.status_code == 422, r.text


# ---------------------------------------------------------------------------
# What a bill earns
# ---------------------------------------------------------------------------


async def test_reaching_the_threshold_earns_the_gift(client: AsyncClient) -> None:
    shop = await _shop(client)
    await _scheme(client, shop)

    sale = await _sell(client, shop, "1.000", "1000.00")
    assert sale["reward_label"] == "Water bottle"


async def test_falling_short_earns_nothing(client: AsyncClient) -> None:
    shop = await _shop(client)
    await _scheme(client, shop)

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["variant_id"], "quantity": "1.000",
                   "discount_pct": "10.00"}],
        "payments": [{"method": "cash", "amount": "900.00"}]})
    assert r.status_code == 201, r.text
    assert r.json()["reward_label"] is None, "₹900 does not reach ₹1,000"


async def test_the_highest_rung_wins_not_both(client: AsyncClient) -> None:
    """₹2,000 earns the steel glass, not the glass AND the bottle."""
    shop = await _shop(client)
    await _ladder(client, shop)

    sale = await _sell(client, shop, "2.000", "2000.00")
    assert sale["reward_label"] == "Steel glass"


async def test_the_threshold_is_the_final_amount_after_discount(
    client: AsyncClient,
) -> None:
    """What the customer actually pays — the number at the bottom of the bill.

    A ₹2,000 cart discounted to ₹1,800 earns the bottle, not the glass.
    """
    shop = await _shop(client)
    await _ladder(client, shop)

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["variant_id"], "quantity": "2.000",
                   "discount_pct": "10.00"}],
        "payments": [{"method": "cash", "amount": "1800.00"}]})
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["grand_total"]) == Decimal("1800.00")
    assert r.json()["reward_label"] == "Water bottle"


async def test_a_scheme_outside_its_dates_does_not_fire(client: AsyncClient) -> None:
    shop = await _shop(client)
    past = business_date() - timedelta(days=30)
    await _scheme(client, shop, valid_from=str(past - timedelta(days=10)),
                  valid_to=str(past))

    sale = await _sell(client, shop, "1.000", "1000.00")
    assert sale["reward_label"] is None


async def test_a_scheme_runs_on_its_last_day(client: AsyncClient) -> None:
    """"Valid to 15 Nov" must include the 15th — the busiest day of a festival."""
    shop = await _shop(client)
    await _scheme(client, shop, valid_from=str(business_date()), valid_to=str(business_date()))

    sale = await _sell(client, shop, "1.000", "1000.00")
    assert sale["reward_label"] == "Water bottle"


async def test_a_scheme_for_the_other_branch_does_not_fire_here(
    client: AsyncClient,
) -> None:
    shop = await _shop(client)
    r = await client.post("/api/v1/stores", headers=shop["h"],
                          json={"code": "OTH", "name": "Other Mall"})
    other = r.json()["id"]
    await _scheme(client, shop, store_id=other)

    sale = await _sell(client, shop, "1.000", "1000.00")
    assert sale["reward_label"] is None


async def test_a_scheme_with_no_branch_runs_everywhere(client: AsyncClient) -> None:
    shop = await _shop(client)
    await _scheme(client, shop, store_id=None)
    sale = await _sell(client, shop, "1.000", "1000.00")
    assert sale["reward_label"] == "Water bottle"


# ---------------------------------------------------------------------------
# The billing screen
# ---------------------------------------------------------------------------


async def test_the_preview_names_the_gap_to_the_next_gift(client: AsyncClient) -> None:
    """The number worth showing.

    "Unlocked" arrives after the money is committed. "₹200 more for a steel
    glass" can still change the sale, which is the whole commercial point.
    """
    shop = await _shop(client)
    await _ladder(client, shop)

    r = await client.get(
        f"/api/v1/rewards/preview/{shop['store_id']}?amount=1800",
        headers=shop["h"],
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["earned"]["gift_label"] == "Water bottle"
    assert body["next_scheme"]["gift_label"] == "Steel glass"
    assert Decimal(body["amount_to_next"]) == Decimal("200.00")


async def test_the_preview_and_the_bill_agree(client: AsyncClient) -> None:
    """The property this feature lives or dies on.

    Both go through the same function, so a customer cannot be promised a gift
    on screen and handed nothing on the bill.
    """
    shop = await _shop(client)
    await _ladder(client, shop)

    r = await client.get(
        f"/api/v1/rewards/preview/{shop['store_id']}?amount=2000", headers=shop["h"]
    )
    promised = r.json()["earned"]["gift_label"]

    sale = await _sell(client, shop, "2.000", "2000.00")
    assert sale["reward_label"] == promised


async def test_an_empty_cart_promises_the_first_rung(client: AsyncClient) -> None:
    shop = await _shop(client)
    await _ladder(client, shop)

    r = await client.get(
        f"/api/v1/rewards/preview/{shop['store_id']}?amount=0", headers=shop["h"]
    )
    body = r.json()
    assert body["earned"] is None
    assert body["next_scheme"]["gift_label"] == "Water bottle"
    assert Decimal(body["amount_to_next"]) == Decimal("1000.00")


# ---------------------------------------------------------------------------
# Counting what went out
# ---------------------------------------------------------------------------


async def test_the_report_counts_the_gifts_given(client: AsyncClient) -> None:
    """No stock link, but the shop still knows what a promotion cost."""
    shop = await _shop(client)
    await _ladder(client, shop)

    await _sell(client, shop, "1.000", "1000.00")
    await _sell(client, shop, "1.000", "1000.00")
    await _sell(client, shop, "2.000", "2000.00")

    r = await client.get("/api/v1/rewards/reports/given", headers=shop["h"])
    assert r.status_code == 200, r.text
    counts = {row["gift_label"]: row["times_given"] for row in r.json()}
    assert counts == {"Water bottle": 2, "Steel glass": 1}


async def test_a_voided_bill_drops_out_of_the_count(client: AsyncClient) -> None:
    """Why the count is derived from bills rather than kept on the scheme.

    A counter would have been incremented and never decremented, and a number
    nobody trusts is worse than no number.
    """
    shop = await _shop(client)
    await _scheme(client, shop)

    sale = await _sell(client, shop, "1.000", "1000.00")
    await _sell(client, shop, "1.000", "1000.00")

    r = await client.post(f"/api/v1/sales/{sale['id']}/void",
                          headers=await elevate(client, shop["token"]),
                          json={"reason": "Rung up twice"})
    assert r.status_code == 200, r.text

    r = await client.get("/api/v1/rewards/reports/given", headers=shop["h"])
    counts = {row["gift_label"]: row["times_given"] for row in r.json()}
    assert counts == {"Water bottle": 1}


async def test_a_deleted_scheme_leaves_its_bills_readable(client: AsyncClient) -> None:
    """The label is snapshotted, so removing a finished promotion cannot blank
    out what customers were actually handed."""
    shop = await _shop(client)
    scheme = await _scheme(client, shop)
    sale = await _sell(client, shop, "1.000", "1000.00")

    await client.delete(f"/api/v1/rewards/{scheme['id']}",
                        headers=await elevate(client, shop["token"]))

    r = await client.get(f"/api/v1/sales/{sale['id']}", headers=shop["h"])
    assert r.json()["reward_label"] == "Water bottle"
    assert r.json()["reward_scheme_id"] is None, "the scheme is gone"

    r = await client.get("/api/v1/rewards/reports/given", headers=shop["h"])
    assert r.json()[0]["gift_label"] == "Water bottle"


async def test_a_shop_with_no_schemes_bills_exactly_as_before(
    client: AsyncClient,
) -> None:
    """Nothing about this feature may affect a shop that never turns it on."""
    shop = await _shop(client)
    sale = await _sell(client, shop, "1.000", "1000.00")
    assert sale["reward_label"] is None
    assert Decimal(sale["grand_total"]) == Decimal("1000.00")
