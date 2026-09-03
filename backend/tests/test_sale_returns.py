"""Sale returns / credit notes.

The properties that actually matter, in the order they would hurt if wrong:

1. Stock physically comes back.
2. A cash refund REDUCES the shift's expected cash — this is the whole reason
   returns are stored with negative amounts, and it is the assertion that would
   have caught storing them positive.
3. Revenue nets the return out, so a sold-then-returned item leaves zero.
4. Nothing can be returned twice, including via two rows in one request.
5. A credit note carries its own serial series, not an invoice number.
6. A full return credits EXACTLY what was charged, to the paisa.
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login


async def _shop(client: AsyncClient) -> dict:
    """A store with an open shift, one product, and stock on hand."""
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h, json={"code": "RT", "name": "Return Store"})
    assert r.status_code == 201, r.text
    store_id = r.json()["id"]

    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False,
    })
    assert r.status_code == 201, r.text
    unit_id = r.json()["id"]

    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Cotton Kurta", "unit_id": unit_id,
        "tax_rate": "5.00", "hsn_code": "6205",
        "variants": [{
            "name": "Navy / L", "sku": "KUR-NV-L",
            "cost_price": "500.00", "mrp": "899.00", "selling_price": "899.00",
            "reorder_point": "2.000", "reorder_quantity": "10.000",
        }],
    })
    assert r.status_code == 201, r.text
    variant_id = r.json()["variants"][0]["id"]

    r = await client.post("/api/v1/day-sessions/open", headers=h, json={
        "store_id": store_id, "opening_cash": "1000.00",
    })
    assert r.status_code == 201, r.text
    session_id = r.json()["id"]

    r = await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": variant_id, "delta": "10.000"}],
    })
    assert r.status_code == 201, r.text

    return {"h": h, "store_id": store_id, "variant_id": variant_id, "session_id": session_id}


async def _sell(client: AsyncClient, shop: dict, qty: str, paid: str) -> dict:
    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["variant_id"], "quantity": qty}],
        "payments": [{"method": "cash", "amount": paid}],
    })
    assert r.status_code == 201, r.text
    return r.json()


async def _stock(client: AsyncClient, shop: dict) -> Decimal:
    r = await client.get(
        f"/api/v1/inventory/levels?store_id={shop['store_id']}", headers=shop["h"]
    )
    assert r.status_code == 200
    for row in r.json()["items"]:
        if row["variant_id"] == shop["variant_id"]:
            return Decimal(row["quantity"])
    return Decimal("0")


async def test_partial_return_puts_stock_back_and_nets_revenue(client: AsyncClient) -> None:
    shop = await _shop(client)
    sale = await _sell(client, shop, "3.000", "2697.00")
    assert await _stock(client, shop) == Decimal("7.000")

    line_id = sale["lines"][0]["id"]
    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
        "lines": [{"sale_line_id": line_id, "quantity": "1.000"}],
        "refunds": [{"method": "cash", "amount": "899.00"}],
        "reason": "Wrong size",
    })
    assert r.status_code == 201, r.text
    credit = r.json()

    # The credit note is a document in its own right, with negative money.
    assert credit["doc_type"] == "return"
    assert credit["original_sale_id"] == sale["id"]
    assert Decimal(credit["grand_total"]) < 0
    assert Decimal(credit["grand_total"]) == Decimal("-899.00")

    # One of three came back.
    assert await _stock(client, shop) == Decimal("8.000")


async def test_cash_refund_reduces_expected_cash(client: AsyncClient) -> None:
    """The assertion that justifies negative storage.

    Opening float 1000 + a 2697 cash sale = 3697 expected. Refund 899 and the
    till should expect 2798. Stored positive, this figure would have gone UP.
    """
    shop = await _shop(client)
    sale = await _sell(client, shop, "3.000", "2697.00")

    r = await client.get(f"/api/v1/day-sessions/{shop['session_id']}/summary", headers=shop["h"])
    assert r.status_code == 200, r.text
    assert Decimal(r.json()["expected_cash"]) == Decimal("3697.00")

    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
        "lines": [{"sale_line_id": sale["lines"][0]["id"], "quantity": "1.000"}],
        "refunds": [{"method": "cash", "amount": "899.00"}],
        "reason": "Wrong size",
    })
    assert r.status_code == 201, r.text

    r = await client.get(f"/api/v1/day-sessions/{shop['session_id']}/summary", headers=shop["h"])
    assert Decimal(r.json()["expected_cash"]) == Decimal("2798.00")


async def test_full_return_credits_exactly_what_was_charged(client: AsyncClient) -> None:
    """A full return must reverse the invoice to the paisa.

    Figures are copied and scaled from the stored line rather than recomputed,
    so whatever rounding the original carried is reproduced exactly.
    """
    shop = await _shop(client)
    sale = await _sell(client, shop, "3.000", "2697.00")

    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
        "lines": [{"sale_line_id": sale["lines"][0]["id"], "quantity": "3.000"}],
        "refunds": [{"method": "cash", "amount": "2697.00"}],
        "reason": "Customer changed mind",
    })
    assert r.status_code == 201, r.text
    credit = r.json()

    for field in ("subtotal", "tax_total", "grand_total"):
        assert Decimal(credit[field]) == -Decimal(sale[field]), field
    assert await _stock(client, shop) == Decimal("10.000")


async def test_cannot_return_more_than_sold(client: AsyncClient) -> None:
    shop = await _shop(client)
    sale = await _sell(client, shop, "2.000", "1798.00")

    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
        "lines": [{"sale_line_id": sale["lines"][0]["id"], "quantity": "3.000"}],
        "refunds": [], "reason": "Too many",
    })
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "RETURN_QUANTITY_EXCEEDS_SOLD"


async def test_cannot_return_the_same_units_twice(client: AsyncClient) -> None:
    shop = await _shop(client)
    sale = await _sell(client, shop, "2.000", "1798.00")
    line_id = sale["lines"][0]["id"]

    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
        "lines": [{"sale_line_id": line_id, "quantity": "2.000"}],
        "refunds": [], "reason": "First",
    })
    assert r.status_code == 201, r.text

    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
        "lines": [{"sale_line_id": line_id, "quantity": "1.000"}],
        "refunds": [], "reason": "Second bite",
    })
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "RETURN_QUANTITY_EXCEEDS_SOLD"


async def test_split_rows_cannot_bypass_the_cap(client: AsyncClient) -> None:
    """Two rows for one line are summed BEFORE the cap is checked."""
    shop = await _shop(client)
    sale = await _sell(client, shop, "2.000", "1798.00")
    line_id = sale["lines"][0]["id"]

    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
        "lines": [
            {"sale_line_id": line_id, "quantity": "2.000"},
            {"sale_line_id": line_id, "quantity": "1.000"},
        ],
        "refunds": [], "reason": "Split attempt",
    })
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "RETURN_QUANTITY_EXCEEDS_SOLD"


async def test_credit_note_has_its_own_serial_series(client: AsyncClient) -> None:
    """GST requires credit notes numbered separately from tax invoices."""
    shop = await _shop(client)
    sale = await _sell(client, shop, "1.000", "899.00")
    assert sale["number"].startswith("INV-RT-")

    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
        "lines": [{"sale_line_id": sale["lines"][0]["id"], "quantity": "1.000"}],
        "refunds": [{"method": "cash", "amount": "899.00"}],
        "reason": "Defective",
    })
    assert r.status_code == 201, r.text
    number = r.json()["number"]
    assert number.startswith("CRN-RT-"), number
    assert number.endswith("0001"), "credit notes start their own count at 1"


async def test_returnable_endpoint_tracks_what_is_left(client: AsyncClient) -> None:
    shop = await _shop(client)
    sale = await _sell(client, shop, "3.000", "2697.00")
    line_id = sale["lines"][0]["id"]

    r = await client.get(f"/api/v1/sales/{sale['id']}/returnable", headers=shop["h"])
    assert r.status_code == 200, r.text
    row = r.json()[0]
    assert Decimal(row["sold_quantity"]) == Decimal("3.000")
    assert Decimal(row["returned_quantity"]) == Decimal("0")
    assert Decimal(row["returnable_quantity"]) == Decimal("3.000")

    await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
        "lines": [{"sale_line_id": line_id, "quantity": "1.000"}],
        "refunds": [], "reason": "One back",
    })

    r = await client.get(f"/api/v1/sales/{sale['id']}/returnable", headers=shop["h"])
    row = r.json()[0]
    assert Decimal(row["returned_quantity"]) == Decimal("1.000")
    assert Decimal(row["returnable_quantity"]) == Decimal("2.000")


async def test_cannot_return_a_voided_sale(client: AsyncClient) -> None:
    """Voiding already reversed the stock and the money."""
    shop = await _shop(client)
    sale = await _sell(client, shop, "1.000", "899.00")

    r = await client.post(f"/api/v1/sales/{sale['id']}/void", headers=shop["h"],
                          json={"reason": "Rung up twice"})
    assert r.status_code == 200, r.text

    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
        "lines": [{"sale_line_id": sale["lines"][0]["id"], "quantity": "1.000"}],
        "refunds": [], "reason": "Also return it",
    })
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "RETURN_OF_VOIDED_SALE"


async def test_cannot_return_a_credit_note(client: AsyncClient) -> None:
    shop = await _shop(client)
    sale = await _sell(client, shop, "2.000", "1798.00")

    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
        "lines": [{"sale_line_id": sale["lines"][0]["id"], "quantity": "1.000"}],
        "refunds": [], "reason": "Return",
    })
    assert r.status_code == 201, r.text
    credit = r.json()

    r = await client.post(f"/api/v1/sales/{credit['id']}/returns", headers=shop["h"], json={
        "lines": [{"sale_line_id": credit["lines"][0]["id"], "quantity": "1.000"}],
        "refunds": [], "reason": "Un-return it",
    })
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "RETURN_OF_RETURN"


async def test_refund_cannot_exceed_the_credit(client: AsyncClient) -> None:
    shop = await _shop(client)
    sale = await _sell(client, shop, "1.000", "899.00")

    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=shop["h"], json={
        "lines": [{"sale_line_id": sale["lines"][0]["id"], "quantity": "1.000"}],
        "refunds": [{"method": "cash", "amount": "1500.00"}],
        "reason": "Over-refund attempt",
    })
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "REFUND_EXCEEDS_CREDIT"
