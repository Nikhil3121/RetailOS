"""Finding a bill the customer no longer has.

Happens every week: someone comes back to exchange a kurta and the bill is
gone. What they DO have is the phone number they gave at the counter. Without
a search the cashier scrolls a date-ordered list hoping to recognise a total.
"""

from __future__ import annotations

from httpx import AsyncClient

from tests._helpers import auth, login


async def _sold(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h,
                          json={"code": "FB", "name": "Find Mall"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    # Stored with the spacing a real person types.
    r = await client.post("/api/v1/customers", headers=h, json={
        "name": "Ramesh Kumar", "phone": "+91 98765 00055"})
    customer_id = r.json()["id"]
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Kurta", "unit_id": unit_id, "tax_rate": "0.00",
        "variants": [{"name": "M", "sku": "FB-1", "cost_price": "200.00",
                      "mrp": "500.00", "selling_price": "500.00",
                      "reorder_point": "1.000", "reorder_quantity": "5.000"}]})
    variant_id = r.json()["variants"][0]["id"]

    await client.post("/api/v1/day-sessions/open", headers=h,
                      json={"store_id": store_id, "opening_cash": "0.00"})
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": variant_id, "delta": "10.000"}]})

    r = await client.post("/api/v1/sales", headers=h, json={
        "store_id": store_id, "customer_id": customer_id,
        "lines": [{"variant_id": variant_id, "quantity": "1"}],
        "payments": [{"method": "cash", "amount": "500.00"}]})
    assert r.status_code == 201, r.text
    sale = r.json()

    # A second bill, for a different customer, that must never come back.
    r = await client.post("/api/v1/customers", headers=h, json={
        "name": "Suresh", "phone": "9000000001"})
    other_customer = r.json()["id"]
    r = await client.post("/api/v1/sales", headers=h, json={
        "store_id": store_id, "customer_id": other_customer,
        "lines": [{"variant_id": variant_id, "quantity": "1"}],
        "payments": [{"method": "cash", "amount": "500.00"}]})
    other_sale = r.json()

    return {"h": h, "store_id": store_id, "sale": sale, "other_sale": other_sale}


async def _search(client: AsyncClient, h: dict, term: str) -> list[str]:
    r = await client.get(f"/api/v1/sales?search={term}", headers=h)
    assert r.status_code == 200, r.text
    return [s["id"] for s in r.json()["items"]]


async def test_a_bill_is_found_by_the_phone_number_as_typed(
    client: AsyncClient,
) -> None:
    s = await _sold(client)
    assert await _search(client, s["h"], "9876500055") == [s["sale"]["id"]]


async def test_the_phone_is_matched_on_digits_not_formatting(
    client: AsyncClient,
) -> None:
    """The number is STORED as "+91 98765 00055". People say it, and type it,
    a dozen different ways. A plain LIKE finds one of them."""
    s = await _sold(client)
    for term in ("98765 00055", "98765-00055", "9876500055", "00055"):
        assert await _search(client, s["h"], term) == [s["sale"]["id"]], term


async def test_a_bill_is_found_by_its_invoice_number(client: AsyncClient) -> None:
    s = await _sold(client)
    number = s["sale"]["number"]
    assert s["sale"]["id"] in await _search(client, s["h"], number)


async def test_a_bill_is_found_by_customer_name(client: AsyncClient) -> None:
    s = await _sold(client)
    assert await _search(client, s["h"], "Ramesh") == [s["sale"]["id"]]


async def test_search_does_not_return_everybody_elses_bills(
    client: AsyncClient,
) -> None:
    """The failure that would make this useless: a term that matches nothing
    quietly returning the whole day."""
    s = await _sold(client)
    assert await _search(client, s["h"], "9876500055") == [s["sale"]["id"]]
    assert await _search(client, s["h"], "zzzznotacustomer") == []


async def test_an_empty_search_still_lists_everything(client: AsyncClient) -> None:
    """Blank must not be treated as "match nothing" — the list screen sends
    the parameter whether or not anyone typed in it."""
    s = await _sold(client)
    r = await client.get("/api/v1/sales?search=", headers=s["h"])
    assert r.status_code == 200, r.text
    assert r.json()["total"] >= 2
