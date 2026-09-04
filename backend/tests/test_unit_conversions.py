"""Unit conversions — buy in cartons, hold stock in pieces.

The rule: the BASE unit is the only unit stock is ever held in. A purchase
quantity is entered in cartons and converted once, at goods receipt, which is
the single point where goods enter the ledger. Converting in the UI instead
would put stock accuracy in the hands of mental arithmetic at the receiving bay.
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login


async def _setup(client: AsyncClient, *, conversion: str | None) -> dict:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h, json={"code": "UC", "name": "Unit Store"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    piece_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Carton", "symbol": "ctn", "is_fractional": False})
    carton_id = r.json()["id"]
    r = await client.post("/api/v1/suppliers", headers=h, json={"code": "S1", "name": "Mill"})
    supplier_id = r.json()["id"]

    body = {
        "name": "Cotton Kurta", "unit_id": piece_id, "tax_rate": "5.00",
        "variants": [{"name": "Default", "sku": "KUR-1", "cost_price": "400.00",
                      "mrp": "899.00", "selling_price": "899.00",
                      "reorder_point": "5.000", "reorder_quantity": "24.000"}],
    }
    if conversion is not None:
        body["purchase_unit_id"] = carton_id
        body["purchase_conversion"] = conversion

    r = await client.post("/api/v1/products", headers=h, json=body)
    assert r.status_code == 201, r.text
    product = r.json()

    return {
        "h": h, "store_id": store_id, "supplier_id": supplier_id,
        "variant_id": product["variants"][0]["id"], "product": product,
        "piece_id": piece_id, "carton_id": carton_id,
    }


async def _receive(client: AsyncClient, ctx: dict, qty: str) -> None:
    h = ctx["h"]
    r = await client.post("/api/v1/purchase-orders", headers=h, json={
        "store_id": ctx["store_id"], "supplier_id": ctx["supplier_id"],
        "order_date": "2026-09-04",
        "lines": [{"variant_id": ctx["variant_id"], "quantity": qty, "unit_cost": "4800.00"}],
    })
    assert r.status_code == 201, r.text
    po_id = r.json()["id"]
    r = await client.post(f"/api/v1/purchase-orders/{po_id}/confirm", headers=h)
    assert r.status_code == 200, r.text
    r = await client.post(f"/api/v1/purchase-orders/{po_id}/receive", headers=h)
    assert r.status_code == 200, r.text


async def _stock(client: AsyncClient, ctx: dict) -> Decimal:
    r = await client.get(
        f"/api/v1/inventory/levels?store_id={ctx['store_id']}", headers=ctx["h"]
    )
    for row in r.json()["items"]:
        if row["variant_id"] == ctx["variant_id"]:
            return Decimal(row["quantity"])
    return Decimal("0")


async def test_receiving_cartons_stocks_pieces(client: AsyncClient) -> None:
    """20 cartons of 12 must land as 240 pieces, not 20."""
    ctx = await _setup(client, conversion="12")
    await _receive(client, ctx, "20.000")
    assert await _stock(client, ctx) == Decimal("240.000")


async def test_a_product_without_a_purchase_unit_is_unchanged(client: AsyncClient) -> None:
    """Every existing product has no purchase unit and must behave exactly as before."""
    ctx = await _setup(client, conversion=None)
    await _receive(client, ctx, "20.000")
    assert await _stock(client, ctx) == Decimal("20.000")


async def test_selling_still_works_in_base_units(client: AsyncClient) -> None:
    """Stock is held in pieces, so a sale of 3 pieces removes exactly 3."""
    ctx = await _setup(client, conversion="12")
    await _receive(client, ctx, "2.000")  # 24 pieces
    assert await _stock(client, ctx) == Decimal("24.000")

    await client.post("/api/v1/day-sessions/open", headers=ctx["h"], json={
        "store_id": ctx["store_id"], "opening_cash": "0.00"})
    r = await client.post("/api/v1/sales", headers=ctx["h"], json={
        "store_id": ctx["store_id"],
        "lines": [{"variant_id": ctx["variant_id"], "quantity": "3.000"}],
        "payments": [{"method": "cash", "amount": "2697.00"}],
    })
    assert r.status_code == 201, r.text
    assert await _stock(client, ctx) == Decimal("21.000")


async def test_fractional_conversion_is_supported(client: AsyncClient) -> None:
    """A 'half dozen' pack is 6 — the factor is Numeric(14,4), not an integer."""
    ctx = await _setup(client, conversion="6.5")
    await _receive(client, ctx, "4.000")
    assert await _stock(client, ctx) == Decimal("26.000")


async def test_conversion_round_trips_through_the_api(client: AsyncClient) -> None:
    ctx = await _setup(client, conversion="12")
    r = await client.get(f"/api/v1/products/{ctx['product']['id']}", headers=ctx["h"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["purchase_unit_id"] == ctx["carton_id"]
    assert Decimal(body["purchase_conversion"]) == Decimal("12")
