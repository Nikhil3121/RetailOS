"""One shop, one day, every feature — end to end.

The unit tests prove each feature in isolation. This proves they compose: price
lists, unit conversions, bundles, advances, credit limits and returns all
touching the same customer, the same stock and the same till in one sequence.

Features interact through shared state, and that is where they break. A bundle
sold at a wholesale rate, returned, against a customer holding an advance and a
credit limit, is not covered by any single-feature test.
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login


async def test_a_full_day_at_the_counter(client: AsyncClient) -> None:
    token = await login(client)
    h = auth(token)

    # ---- 1. Setup, in the order the workflow document prescribes -----------
    r = await client.post("/api/v1/stores", headers=h, json={"code": "E2E", "name": "M.S. Mall"})
    assert r.status_code == 201, r.text
    store = r.json()["id"]

    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    piece = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Carton", "symbol": "ctn", "is_fractional": False})
    carton = r.json()["id"]

    r = await client.post("/api/v1/suppliers", headers=h, json={"code": "MILL", "name": "Mill"})
    supplier = r.json()["id"]

    def variant(sku, price, mrp=None):
        return {"name": "Default", "sku": sku, "cost_price": "300.00",
                "mrp": mrp or price, "selling_price": price,
                "reorder_point": "2.000", "reorder_quantity": "12.000"}

    # A kurta bought by the carton of 12, and a dupatta sold singly.
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Cotton Kurta", "unit_id": piece, "tax_rate": "5.00", "hsn_code": "6205",
        "purchase_unit_id": carton, "purchase_conversion": "12",
        "variants": [variant("KUR-L", "1000.00")]})
    assert r.status_code == 201, r.text
    kurta = r.json()["variants"][0]["id"]

    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Dupatta", "unit_id": piece, "tax_rate": "5.00",
        "variants": [variant("DUP-1", "500.00")]})
    dupatta = r.json()["variants"][0]["id"]

    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Kurta Set", "unit_id": piece, "tax_rate": "5.00",
        "variants": [variant("SET-1", "1300.00")]})
    combo = r.json()["variants"][0]["id"]

    # ---- 2. The combo is a bundle: one kurta plus one dupatta --------------
    r = await client.put(f"/api/v1/bundles/{combo}", headers=h, json={
        "components": [{"component_variant_id": kurta, "quantity": "1.000"},
                       {"component_variant_id": dupatta, "quantity": "1.000"}]})
    assert r.status_code == 200, r.text

    # ---- 3. A wholesale rate card ------------------------------------------
    r = await client.post("/api/v1/price-lists", headers=h, json={
        "code": "WHOLESALE", "name": "Wholesale"})
    wholesale = r.json()["id"]
    r = await client.put(f"/api/v1/price-lists/{wholesale}/items", headers=h, json={
        "items": [{"variant_id": combo, "price": "1100.00"}]})
    assert r.status_code == 200, r.text

    # A wholesale customer with a credit ceiling.
    r = await client.post("/api/v1/customers", headers=h, json={
        "name": "Bazaar Trader", "price_list_id": wholesale, "credit_limit": "2000.00"})
    assert r.status_code == 201, r.text
    customer = r.json()["id"]

    # ---- 4. Open the shift and receive stock BY THE CARTON ------------------
    r = await client.post("/api/v1/day-sessions/open", headers=h, json={
        "store_id": store, "opening_cash": "1000.00"})
    session = r.json()["id"]

    r = await client.post("/api/v1/purchase-orders", headers=h, json={
        "store_id": store, "supplier_id": supplier, "order_date": "2026-09-04",
        "lines": [{"variant_id": kurta, "quantity": "2.000", "unit_cost": "3600.00"}]})
    po = r.json()["id"]
    await client.post(f"/api/v1/purchase-orders/{po}/confirm", headers=h)
    r = await client.post(f"/api/v1/purchase-orders/{po}/receive", headers=h)
    assert r.status_code == 200, r.text

    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": dupatta, "delta": "10.000"}]})

    async def stock(vid: str) -> Decimal:
        rr = await client.get(f"/api/v1/inventory/levels?store_id={store}", headers=h)
        for row in rr.json()["items"]:
            if row["variant_id"] == vid:
                return Decimal(row["quantity"])
        return Decimal("0")

    # 2 cartons of 12 = 24 pieces, NOT 2.
    assert await stock(kurta) == Decimal("24.000"), "unit conversion"

    # ---- 5. The customer pays an advance -----------------------------------
    r = await client.post("/api/v1/sales/advances", headers=h, json={
        "store_id": store, "customer_id": customer,
        "payments": [{"method": "cash", "amount": "1500.00"}]})
    assert r.status_code == 201, r.text
    assert r.json()["number"].startswith("ADV-E2E-")

    # Cash is in the drawer: 1000 float + 1500 advance.
    r = await client.get(f"/api/v1/day-sessions/{session}/summary", headers=h)
    assert Decimal(r.json()["expected_cash"]) == Decimal("2500.00"), "advance reaches the till"

    # ---- 6. Sell two combos ON CREDIT at the wholesale rate ----------------
    #
    # 2 x 1100 = 2200 owed. The limit is 2000, but the shop already holds a
    # 1500 advance, so the customer's net exposure is 700 and this must pass.
    r = await client.post("/api/v1/sales", headers=h, json={
        "store_id": store, "customer_id": customer,
        "lines": [{"variant_id": combo, "quantity": "2.000"}],
        "payments": []})
    assert r.status_code == 201, r.text
    sale = r.json()
    sale_id = sale["id"]

    # Wholesale rate, not the 1300 shelf price.
    assert Decimal(sale["lines"][0]["unit_price"]) == Decimal("1100.00"), "price list"
    assert Decimal(sale["grand_total"]) == Decimal("2200.00")

    # The bundle came out of its COMPONENTS, not out of itself.
    assert await stock(kurta) == Decimal("22.000"), "bundle explodes to components"
    assert await stock(dupatta) == Decimal("8.000")
    assert await stock(combo) == Decimal("0"), "a combo is never stocked"

    # ---- 7. The credit limit still bites -----------------------------------
    r = await client.post("/api/v1/sales", headers=h, json={
        "store_id": store, "customer_id": customer,
        "lines": [{"variant_id": combo, "quantity": "3.000"}],
        "payments": []})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "CREDIT_LIMIT_EXCEEDED"

    # ---- 8. One combo comes back -------------------------------------------
    r = await client.get(f"/api/v1/sales/{sale_id}/returnable", headers=h)
    assert r.status_code == 200, r.text
    line_id = r.json()[0]["sale_line_id"]
    assert Decimal(r.json()[0]["returnable_quantity"]) == Decimal("2.000")

    r = await client.post(f"/api/v1/sales/{sale_id}/returns", headers=h, json={
        "lines": [{"sale_line_id": line_id, "quantity": "1.000"}],
        "refunds": [{"method": "cash", "amount": "1100.00"}],
        "reason": "Wrong colour"})
    assert r.status_code == 201, r.text
    credit = r.json()
    assert credit["number"].startswith("CRN-E2E-")
    assert Decimal(credit["grand_total"]) == Decimal("-1100.00"), "returns store negative"

    # Cash went back out of the drawer.
    r = await client.get(f"/api/v1/day-sessions/{session}/summary", headers=h)
    assert Decimal(r.json()["expected_cash"]) == Decimal("1400.00"), "refund leaves the till"

    # Half the bill is credited, so half is returnable now.
    r = await client.get(f"/api/v1/sales/{sale_id}/returnable", headers=h)
    assert Decimal(r.json()[0]["returnable_quantity"]) == Decimal("1.000")

    # ---- 9. The customer's position is the sum of all of it ----------------
    r = await client.get(f"/api/v1/sales/customers/{customer}/balance", headers=h)
    assert r.status_code == 200, r.text
    balance = r.json()
    # Owed: 2200 on the credit bill. Held: 1500 advance + 1100 un-refunded
    # credit-note balance... the credit note refunded in full, so its balance
    # is 0 and only the advance is held.
    assert Decimal(balance["owed_by_customer"]) == Decimal("2200.00")
    assert Decimal(balance["advance_held"]) == Decimal("1500.00")
    assert Decimal(balance["net_balance"]) == Decimal("700.00")
