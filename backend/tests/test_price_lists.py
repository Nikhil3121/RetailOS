"""Price lists — wholesale, retail and dealer rates.

The property that matters above all others: THE PRICE ON THE BILL IS THE
CUSTOMER'S RATE, resolved by the same function the billing screen calls. A
screen showing ₹700 while the stored line says ₹899 is the failure this whole
feature exists to prevent.

Also covered: a sparse list falls through per-variant, an explicit override at
the counter still wins, an archived list stops applying, and only one list can
be the default.
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, elevate, login


async def _shop(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h, json={"code": "PL", "name": "Price Store"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False,
    })
    unit_id = r.json()["id"]

    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Cotton Kurta", "unit_id": unit_id, "tax_rate": "5.00", "hsn_code": "6205",
        "variants": [
            {"name": "Navy / L", "sku": "KUR-NV-L", "cost_price": "500.00",
             "mrp": "899.00", "selling_price": "899.00",
             "reorder_point": "2.000", "reorder_quantity": "10.000"},
            {"name": "Navy / M", "sku": "KUR-NV-M", "cost_price": "500.00",
             "mrp": "899.00", "selling_price": "899.00",
             "reorder_point": "2.000", "reorder_quantity": "10.000"},
        ],
    })
    assert r.status_code == 201, r.text
    variants = r.json()["variants"]

    await client.post("/api/v1/day-sessions/open", headers=h, json={
        "store_id": store_id, "opening_cash": "1000.00",
    })
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": v["id"], "delta": "50.000"} for v in variants],
    })

    return {
        "h": h, "token": token, "store_id": store_id,
        "v1": variants[0]["id"], "v2": variants[1]["id"],
    }


async def _wholesale_list(client: AsyncClient, shop: dict, rates: dict) -> str:
    r = await client.post("/api/v1/price-lists", headers=shop["h"], json={
        "code": "WHOLESALE", "name": "Wholesale",
    })
    assert r.status_code == 201, r.text
    list_id = r.json()["id"]
    r = await client.put(f"/api/v1/price-lists/{list_id}/items", headers=shop["h"], json={
        "items": [{"variant_id": vid, "price": price} for vid, price in rates.items()],
    })
    assert r.status_code == 200, r.text
    return list_id


async def test_bill_uses_the_customers_rate_not_the_shelf_price(client: AsyncClient) -> None:
    """The whole point of the feature."""
    shop = await _shop(client)
    list_id = await _wholesale_list(client, shop, {shop["v1"]: "700.00"})

    r = await client.post("/api/v1/customers", headers=shop["h"], json={
        "name": "Bulk Buyer", "price_list_id": list_id,
    })
    assert r.status_code == 201, r.text
    customer_id = r.json()["id"]

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "customer_id": customer_id,
        "lines": [{"variant_id": shop["v1"], "quantity": "2.000"}],
        "payments": [{"method": "cash", "amount": "1400.00"}],
    })
    assert r.status_code == 201, r.text
    sale = r.json()
    assert Decimal(sale["lines"][0]["unit_price"]) == Decimal("700.00")
    assert Decimal(sale["grand_total"]) == Decimal("1400.00")


async def test_walk_in_still_pays_the_shelf_price(client: AsyncClient) -> None:
    shop = await _shop(client)
    await _wholesale_list(client, shop, {shop["v1"]: "700.00"})

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["v1"], "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "899.00"}],
    })
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["lines"][0]["unit_price"]) == Decimal("899.00")


async def test_a_sparse_list_falls_through_per_variant(client: AsyncClient) -> None:
    """A new list with two rates on it must be usable immediately.

    Requiring a rate for all 9,000 variants before the list could be used would
    mean it never got used.
    """
    shop = await _shop(client)
    list_id = await _wholesale_list(client, shop, {shop["v1"]: "700.00"})
    r = await client.post("/api/v1/customers", headers=shop["h"], json={
        "name": "Partial", "price_list_id": list_id,
    })
    customer_id = r.json()["id"]

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "customer_id": customer_id,
        "lines": [
            {"variant_id": shop["v1"], "quantity": "1.000"},
            {"variant_id": shop["v2"], "quantity": "1.000"},
        ],
        "payments": [{"method": "cash", "amount": "1599.00"}],
    })
    assert r.status_code == 201, r.text
    prices = {l["sku"]: Decimal(l["unit_price"]) for l in r.json()["lines"]}
    assert prices["KUR-NV-L"] == Decimal("700.00"), "on the list"
    assert prices["KUR-NV-M"] == Decimal("899.00"), "not on the list — own price"


async def test_counter_override_beats_the_list(client: AsyncClient) -> None:
    """A negotiated rate at the counter is the price actually charged."""
    shop = await _shop(client)
    list_id = await _wholesale_list(client, shop, {shop["v1"]: "700.00"})
    r = await client.post("/api/v1/customers", headers=shop["h"], json={
        "name": "Haggler", "price_list_id": list_id,
    })
    customer_id = r.json()["id"]

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "customer_id": customer_id,
        "lines": [{"variant_id": shop["v1"], "quantity": "1.000", "unit_price": "650.00"}],
        "payments": [{"method": "cash", "amount": "650.00"}],
    })
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["lines"][0]["unit_price"]) == Decimal("650.00")


async def test_default_list_applies_without_being_assigned(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await client.post("/api/v1/price-lists", headers=shop["h"], json={
        "code": "RETAIL", "name": "Retail", "is_default": True,
    })
    assert r.status_code == 201, r.text
    list_id = r.json()["id"]
    await client.put(f"/api/v1/price-lists/{list_id}/items", headers=shop["h"], json={
        "items": [{"variant_id": shop["v1"], "price": "849.00"}],
    })

    # A customer with NO list of their own still gets the default rate.
    r = await client.post("/api/v1/customers", headers=shop["h"], json={"name": "Nobody Special"})
    customer_id = r.json()["id"]

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"], "customer_id": customer_id,
        "lines": [{"variant_id": shop["v1"], "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "849.00"}],
    })
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["lines"][0]["unit_price"]) == Decimal("849.00")


async def test_archiving_a_list_stops_it_setting_prices(client: AsyncClient) -> None:
    shop = await _shop(client)
    list_id = await _wholesale_list(client, shop, {shop["v1"]: "700.00"})
    r = await client.post("/api/v1/customers", headers=shop["h"], json={
        "name": "Ex-wholesale", "price_list_id": list_id,
    })
    customer_id = r.json()["id"]

    r = await client.patch(f"/api/v1/price-lists/{list_id}", headers=shop["h"],
                           json={"is_active": False})
    assert r.status_code == 200, r.text

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"], "customer_id": customer_id,
        "lines": [{"variant_id": shop["v1"], "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "899.00"}],
    })
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["lines"][0]["unit_price"]) == Decimal("899.00")


async def test_only_one_list_can_be_default(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await client.post("/api/v1/price-lists", headers=shop["h"], json={
        "code": "A", "name": "First", "is_default": True,
    })
    first = r.json()["id"]
    r = await client.post("/api/v1/price-lists", headers=shop["h"], json={
        "code": "B", "name": "Second", "is_default": True,
    })
    assert r.status_code == 201, r.text

    r = await client.get("/api/v1/price-lists", headers=shop["h"])
    defaults = [pl for pl in r.json() if pl["is_default"]]
    assert len(defaults) == 1, "a second default must demote the first"
    assert defaults[0]["code"] == "B"
    assert first != defaults[0]["id"]


async def test_resolve_endpoint_matches_what_the_bill_stores(client: AsyncClient) -> None:
    """The screen and the stored line must come from the same function."""
    shop = await _shop(client)
    list_id = await _wholesale_list(client, shop, {shop["v1"]: "700.00"})
    r = await client.post("/api/v1/customers", headers=shop["h"], json={
        "name": "Checker", "price_list_id": list_id,
    })
    customer_id = r.json()["id"]

    r = await client.post("/api/v1/price-lists/resolve", headers=shop["h"], json={
        "customer_id": customer_id, "variant_ids": [shop["v1"], shop["v2"]],
    })
    assert r.status_code == 200, r.text
    quoted = {row["variant_id"]: row for row in r.json()}
    assert Decimal(quoted[shop["v1"]]["price"]) == Decimal("700.00")
    assert quoted[shop["v1"]]["source"] == "price_list"
    assert Decimal(quoted[shop["v1"]]["base_price"]) == Decimal("899.00")
    assert quoted[shop["v2"]]["source"] == "variant"

    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"], "customer_id": customer_id,
        "lines": [{"variant_id": shop["v1"], "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "700.00"}],
    })
    stored = Decimal(r.json()["lines"][0]["unit_price"])
    assert stored == Decimal(quoted[shop["v1"]]["price"]), "quote and bill must agree"


async def test_removing_a_rate_reverts_to_the_shelf_price(client: AsyncClient) -> None:
    shop = await _shop(client)
    list_id = await _wholesale_list(client, shop, {shop["v1"]: "700.00"})

    r = await client.delete(
        f"/api/v1/price-lists/{list_id}/items/{shop['v1']}",
        headers=await elevate(client, shop["token"]),
    )
    assert r.status_code == 204, r.text

    r = await client.post("/api/v1/price-lists/resolve", headers=shop["h"], json={
        "customer_id": None, "variant_ids": [shop["v1"]],
    })
    assert Decimal(r.json()[0]["price"]) == Decimal("899.00")


async def test_duplicate_code_is_rejected(client: AsyncClient) -> None:
    shop = await _shop(client)
    await client.post("/api/v1/price-lists", headers=shop["h"],
                      json={"code": "DEALER", "name": "Dealer"})
    r = await client.post("/api/v1/price-lists", headers=shop["h"],
                          json={"code": "DEALER", "name": "Dealer again"})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "PRICE_LIST_CODE_TAKEN"
