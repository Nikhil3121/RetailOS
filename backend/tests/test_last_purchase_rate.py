"""What an item cost the last time it was actually bought.

A buyer raising a purchase order is deciding whether the rate in front of them
is fair. Without the last one they are guessing, or — most often — accepting
whatever the supplier quoted. A rate that crept up 8% between orders is
invisible until the two numbers sit next to each other.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login


async def _shop(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h,
                          json={"code": "LR", "name": "Rate Mall"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/suppliers", headers=h,
                          json={"name": "Surat Textiles", "code": "SUR"})
    supplier_a = r.json()["id"]
    r = await client.post("/api/v1/suppliers", headers=h,
                          json={"name": "Delhi Fabrics", "code": "DEL"})
    supplier_b = r.json()["id"]
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Saree", "unit_id": unit_id, "tax_rate": "0.00",
        "variants": [{"name": "Red", "sku": "LR-1", "cost_price": "400.00",
                      "mrp": "1000.00", "selling_price": "1000.00",
                      "reorder_point": "1.000", "reorder_quantity": "5.000"}]})
    variant_id = r.json()["variants"][0]["id"]

    return {"h": h, "store_id": store_id, "variant_id": variant_id,
            "supplier_a": supplier_a, "supplier_b": supplier_b}


async def _po(
    client: AsyncClient, s: dict, supplier_id: str, cost: str,
    order_date: str, receive: bool = True,
) -> dict:
    r = await client.post("/api/v1/purchase-orders", headers=s["h"], json={
        "supplier_id": supplier_id, "store_id": s["store_id"],
        "order_date": order_date,
        "lines": [{"variant_id": s["variant_id"], "quantity": "10",
                   "unit_cost": cost}]})
    assert r.status_code == 201, r.text
    po = r.json()
    if receive:
        r = await client.post(
            f"/api/v1/purchase-orders/{po['id']}/confirm", headers=s["h"])
        assert r.status_code == 200, r.text
        r = await client.post(
            f"/api/v1/purchase-orders/{po['id']}/receive", headers=s["h"])
        assert r.status_code == 200, r.text
        po = r.json()
    return po


async def _rates(client: AsyncClient, s: dict, supplier_id: str | None = None) -> list:
    url = f"/api/v1/purchase-orders/last-rates?variant_ids={s['variant_id']}"
    if supplier_id:
        url += f"&supplier_id={supplier_id}"
    r = await client.get(url, headers=s["h"])
    assert r.status_code == 200, r.text
    return r.json()


async def test_the_last_received_rate_comes_back(client: AsyncClient) -> None:
    s = await _shop(client)
    await _po(client, s, s["supplier_a"], "380.00", date.today().isoformat())

    rows = await _rates(client, s)
    assert len(rows) == 1
    assert Decimal(rows[0]["unit_cost"]) == Decimal("380.00")
    assert rows[0]["supplier_name"] == "Surat Textiles"


async def test_the_most_recent_order_wins(client: AsyncClient) -> None:
    s = await _shop(client)
    old = (date.today() - timedelta(days=60)).isoformat()
    await _po(client, s, s["supplier_a"], "350.00", old)
    await _po(client, s, s["supplier_a"], "410.00", date.today().isoformat())

    rows = await _rates(client, s)
    assert Decimal(rows[0]["unit_cost"]) == Decimal("410.00")


async def test_ordered_by_order_date_not_by_when_it_was_typed_in(
    client: AsyncClient,
) -> None:
    """A paper GRN typed up a week late must not outrank an order placed after
    it. The buyer means "the last time we bought this"."""
    s = await _shop(client)
    # Entered SECOND, but ordered EARLIER.
    await _po(client, s, s["supplier_a"], "410.00", date.today().isoformat())
    await _po(client, s, s["supplier_a"], "350.00",
              (date.today() - timedelta(days=30)).isoformat())

    rows = await _rates(client, s)
    assert Decimal(rows[0]["unit_cost"]) == Decimal("410.00")


async def test_a_rate_that_was_never_received_is_not_quoted_back(
    client: AsyncClient,
) -> None:
    """THE ONE THAT MATTERS.

    A draft order records a rate that was PROPOSED, not paid. Quoting it back
    as "what it cost last time" would let a price the shop never agreed to
    become the baseline it negotiates from.
    """
    s = await _shop(client)
    await _po(client, s, s["supplier_a"], "350.00",
              (date.today() - timedelta(days=10)).isoformat())
    # A wild quote, left as a draft.
    await _po(client, s, s["supplier_a"], "999.00", date.today().isoformat(),
              receive=False)

    rows = await _rates(client, s)
    assert Decimal(rows[0]["unit_cost"]) == Decimal("350.00")


async def test_a_rate_from_another_supplier_is_flagged(client: AsyncClient) -> None:
    """A cheaper rate elsewhere is worth knowing; a cheaper rate from the same
    supplier is a negotiating position. They are not the same fact."""
    s = await _shop(client)
    await _po(client, s, s["supplier_b"], "360.00", date.today().isoformat())

    rows = await _rates(client, s, supplier_id=s["supplier_a"])
    assert rows[0]["from_other_supplier"] is True

    rows = await _rates(client, s, supplier_id=s["supplier_b"])
    assert rows[0]["from_other_supplier"] is False


async def test_an_item_never_bought_returns_nothing_rather_than_zero(
    client: AsyncClient,
) -> None:
    """A rate of ₹0.00 would read as "it used to be free" and anchor the buyer
    at the worst possible number."""
    s = await _shop(client)
    rows = await _rates(client, s)
    assert rows == []


async def test_the_route_is_not_swallowed_by_the_id_route(
    client: AsyncClient,
) -> None:
    """`/purchase-orders/{po_id}` is declared with a UUID path parameter. With
    the routes the wrong way round, "last-rates" reads as a malformed id and
    answers 422 — which looks exactly like a bug in the caller."""
    s = await _shop(client)
    r = await client.get(
        f"/api/v1/purchase-orders/last-rates?variant_ids={s['variant_id']}",
        headers=s["h"])
    assert r.status_code == 200, r.text
