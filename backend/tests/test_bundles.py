"""Product bundles — a combo sold as one line, stocked as its parts.

The rule the whole feature turns on: STOCK MOVES FOR THE COMPONENTS, NEVER FOR
THE BUNDLE. A "saree + blouse" combo is a way of selling, not a thing on a
shelf. Decrementing the bundle as well would count the same physical garment
twice.
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, elevate, login


async def _shop(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)
    r = await client.post("/api/v1/stores", headers=h, json={"code": "BN", "name": "Bundle Store"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]

    def variant(sku, price):
        return {"name": "Default", "sku": sku, "cost_price": "100.00",
                "mrp": price, "selling_price": price,
                "reorder_point": "1.000", "reorder_quantity": "5.000"}

    ids = {}
    for name, sku, price in [("Saree", "SAR", "3000.00"),
                             ("Blouse", "BLS", "800.00"),
                             ("Saree Combo", "COMBO", "3500.00")]:
        r = await client.post("/api/v1/products", headers=h, json={
            "name": name, "unit_id": unit_id, "tax_rate": "5.00",
            "variants": [variant(sku, price)]})
        assert r.status_code == 201, r.text
        ids[sku] = r.json()["variants"][0]["id"]

    await client.post("/api/v1/day-sessions/open", headers=h,
                      json={"store_id": store_id, "opening_cash": "0.00"})
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": ids["SAR"], "delta": "10.000"},
                  {"variant_id": ids["BLS"], "delta": "10.000"}]})
    return {"h": h, "token": token, "store_id": store_id, **ids}


async def _make_bundle(client: AsyncClient, shop: dict, components: list[dict]):
    return await client.put(f"/api/v1/bundles/{shop['COMBO']}", headers=shop["h"],
                            json={"components": components})


async def _stock(client: AsyncClient, shop: dict, variant_id: str) -> Decimal:
    r = await client.get(f"/api/v1/inventory/levels?store_id={shop['store_id']}",
                         headers=shop["h"])
    for row in r.json()["items"]:
        if row["variant_id"] == variant_id:
            return Decimal(row["quantity"])
    return Decimal("0")


async def test_selling_a_bundle_moves_its_components(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await _make_bundle(client, shop, [
        {"component_variant_id": shop["SAR"], "quantity": "1.000"},
        {"component_variant_id": shop["BLS"], "quantity": "1.000"},
    ])
    assert r.status_code == 200, r.text

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["COMBO"], "quantity": "2.000"}],
        "payments": [{"method": "cash", "amount": "7000.00"}]})
    assert r.status_code == 201, r.text

    assert await _stock(client, shop, shop["SAR"]) == Decimal("8.000")
    assert await _stock(client, shop, shop["BLS"]) == Decimal("8.000")
    # The combo itself is never stocked — it is a way of selling, not a thing.
    assert await _stock(client, shop, shop["COMBO"]) == Decimal("0")


async def test_component_quantities_multiply(client: AsyncClient) -> None:
    """A combo of 1 saree + 2 blouses, sold 3 times, is 3 sarees and 6 blouses."""
    shop = await _shop(client)
    await _make_bundle(client, shop, [
        {"component_variant_id": shop["SAR"], "quantity": "1.000"},
        {"component_variant_id": shop["BLS"], "quantity": "2.000"},
    ])
    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["COMBO"], "quantity": "3.000"}],
        "payments": [{"method": "cash", "amount": "10500.00"}]})
    assert r.status_code == 201, r.text

    assert await _stock(client, shop, shop["SAR"]) == Decimal("7.000")
    assert await _stock(client, shop, shop["BLS"]) == Decimal("4.000")


async def test_the_bill_charges_the_bundle_price_not_the_parts(client: AsyncClient) -> None:
    """3000 + 800 is 3800, but the combo sells for 3500. That is the point."""
    shop = await _shop(client)
    await _make_bundle(client, shop, [
        {"component_variant_id": shop["SAR"], "quantity": "1.000"},
        {"component_variant_id": shop["BLS"], "quantity": "1.000"},
    ])
    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["COMBO"], "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "3500.00"}]})
    assert r.status_code == 201, r.text
    sale = r.json()
    assert len(sale["lines"]) == 1, "one line on the bill, not two"
    assert Decimal(sale["grand_total"]) == Decimal("3500.00")


async def test_an_ordinary_product_is_unaffected(client: AsyncClient) -> None:
    """Everything that is not a bundle must move its own stock exactly as before."""
    shop = await _shop(client)
    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["SAR"], "quantity": "2.000"}],
        "payments": [{"method": "cash", "amount": "6000.00"}]})
    assert r.status_code == 201, r.text
    assert await _stock(client, shop, shop["SAR"]) == Decimal("8.000")


async def test_a_bundle_cannot_contain_itself(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await _make_bundle(client, shop, [
        {"component_variant_id": shop["COMBO"], "quantity": "1.000"}])
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "BUNDLE_SELF_REFERENCE"


async def test_a_bundle_cannot_contain_another_bundle(client: AsyncClient) -> None:
    """Nested bundles would need recursive explosion. Refused, not half-done."""
    shop = await _shop(client)
    await _make_bundle(client, shop, [
        {"component_variant_id": shop["SAR"], "quantity": "1.000"}])

    # Try to make the blouse a bundle whose component is the existing combo.
    r = await client.put(f"/api/v1/bundles/{shop['BLS']}", headers=shop["h"], json={
        "components": [{"component_variant_id": shop["COMBO"], "quantity": "1.000"}]})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "BUNDLE_NESTED"


async def test_replacing_a_recipe_drops_what_is_left_out(client: AsyncClient) -> None:
    """Replace, not upsert — omitting a component means it left the combo."""
    shop = await _shop(client)
    await _make_bundle(client, shop, [
        {"component_variant_id": shop["SAR"], "quantity": "1.000"},
        {"component_variant_id": shop["BLS"], "quantity": "1.000"},
    ])
    r = await _make_bundle(client, shop, [
        {"component_variant_id": shop["SAR"], "quantity": "1.000"}])
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["COMBO"], "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "3500.00"}]})
    assert r.status_code == 201, r.text
    assert await _stock(client, shop, shop["BLS"]) == Decimal("10.000"), "blouse left the combo"


async def test_clearing_a_bundle_makes_it_an_ordinary_product(client: AsyncClient) -> None:
    shop = await _shop(client)
    await _make_bundle(client, shop, [
        {"component_variant_id": shop["SAR"], "quantity": "1.000"}])
    r = await client.delete(f"/api/v1/bundles/{shop['COMBO']}",
                            headers=await elevate(client, shop["token"]))
    assert r.status_code == 204, r.text

    r = await client.get(f"/api/v1/bundles/{shop['COMBO']}", headers=shop["h"])
    assert r.json() == []
