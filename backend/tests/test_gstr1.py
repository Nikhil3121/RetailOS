"""GSTR-1 — the monthly outward-supplies return, as a working paper.

The three things that are easy to get wrong, and that these tests pin down:

SIGNS. This system stores credit notes as negative money so revenue aggregates
net them out for free. GSTR-1 reports them POSITIVE — a credit note reduces the
liability by being a credit note. Get this wrong and a return is deducted twice.

PLACE OF SUPPLY. Read from the customer's GSTIN, not from a typed address
field, because the number is what the tax office checks. For a counter sale it
is the shop's own state: goods handed across a desk are supplied where the desk
is.

WHAT IS MISSING. A line with no HSN code does not vanish into a smaller total.
It is counted and reported, because an accountant who is not told files short.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login

# 09 = Uttar Pradesh. The first two digits of a GSTIN are the state code.
HOME_GSTIN = "09AAACR5055K1Z5"
UP_CUSTOMER_GSTIN = "09AAACX1234R1Z2"
MH_CUSTOMER_GSTIN = "27AAACY9876P1Z8"


async def _shop(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h, json={
        "code": "GS", "name": "GST Mall", "gstin": HOME_GSTIN,
        "state": "Uttar Pradesh"})
    assert r.status_code == 201, r.text
    store_id = r.json()["id"]

    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Saree", "unit_id": unit_id, "tax_rate": "5.00",
        "hsn_code": "5407",
        "variants": [{"name": "Red", "sku": "GS-1", "cost_price": "400.00",
                      "mrp": "1050.00", "selling_price": "1050.00",
                      "reorder_point": "1.000", "reorder_quantity": "5.000"}]})
    variant_id = r.json()["variants"][0]["id"]

    await client.post("/api/v1/day-sessions/open", headers=h,
                      json={"store_id": store_id, "opening_cash": "0.00"})
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": variant_id, "delta": "100.000"}]})

    return {"h": h, "store_id": store_id, "variant_id": variant_id,
            "unit_id": unit_id}


async def _sell(
    client: AsyncClient, s: dict, customer_id: str | None = None, qty: str = "1",
    amount: str = "1050.00",
) -> dict:
    r = await client.post("/api/v1/sales", headers=s["h"], json={
        "store_id": s["store_id"], "customer_id": customer_id,
        "lines": [{"variant_id": s["variant_id"], "quantity": qty}],
        "payments": [{"method": "cash", "amount": amount}]})
    assert r.status_code == 201, r.text
    return r.json()


async def _gstr1(client: AsyncClient, s: dict) -> dict:
    r = await client.get(
        f"/api/v1/reports/gstr1?store_id={s['store_id']}", headers=s["h"])
    assert r.status_code == 200, r.text
    return r.json()


async def _customer(client: AsyncClient, s: dict, **kw) -> str:
    r = await client.post("/api/v1/customers", headers=s["h"], json=kw)
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------------------------------------------------------------------------
# B2B vs B2C
# ---------------------------------------------------------------------------


async def test_a_registered_customer_is_reported_invoice_by_invoice(
    client: AsyncClient,
) -> None:
    """The recipient claims input credit against each one; a summary would
    leave them nothing to match."""
    s = await _shop(client)
    cid = await _customer(client, s, name="Sharma Traders", phone="9000000001",
                          gstin=UP_CUSTOMER_GSTIN)
    sale = await _sell(client, s, customer_id=cid)

    body = await _gstr1(client, s)
    assert len(body["b2b"]) == 1
    row = body["b2b"][0]
    assert row["invoice_number"] == sale["number"]
    assert row["customer_gstin"] == UP_CUSTOMER_GSTIN
    assert Decimal(row["invoice_value"]) == Decimal("1050.00")
    # And it is NOT also in the counter-sales summary.
    assert body["b2cs"] == []


async def test_a_walk_in_sale_is_summarised_not_listed(client: AsyncClient) -> None:
    """There is nobody to claim credit, so unregistered sales collapse to one
    row per place of supply and rate."""
    s = await _shop(client)
    await _sell(client, s)
    await _sell(client, s)

    body = await _gstr1(client, s)
    assert body["b2b"] == []
    assert len(body["b2cs"]) == 1
    assert body["b2cs"][0]["invoice_count"] == 2
    assert Decimal(body["b2cs"][0]["taxable_value"]) == Decimal("2000.00")


# ---------------------------------------------------------------------------
# Place of supply
# ---------------------------------------------------------------------------


async def test_place_of_supply_comes_from_the_gstin_not_the_address(
    client: AsyncClient,
) -> None:
    """A customer whose GSTIN says 27 and whose address says Uttar Pradesh has
    one of them entered wrong. The return follows the one the tax office
    checks."""
    s = await _shop(client)
    cid = await _customer(client, s, name="Mumbai Silks", phone="9000000002",
                          gstin=MH_CUSTOMER_GSTIN, state="Uttar Pradesh")
    await _sell(client, s, customer_id=cid)

    body = await _gstr1(client, s)
    assert body["b2b"][0]["place_of_supply"] == "27"


async def test_an_inter_state_sale_carries_igst_not_cgst_and_sgst(
    client: AsyncClient,
) -> None:
    s = await _shop(client)
    cid = await _customer(client, s, name="Mumbai Silks", phone="9000000003",
                          gstin=MH_CUSTOMER_GSTIN)
    await _sell(client, s, customer_id=cid)

    line = (await _gstr1(client, s))["b2b"][0]["lines"][0]
    assert Decimal(line["igst"]) == Decimal("50.00")
    assert Decimal(line["cgst"]) == Decimal("0.00")
    assert Decimal(line["sgst"]) == Decimal("0.00")


async def test_an_intra_state_sale_splits_into_cgst_and_sgst(
    client: AsyncClient,
) -> None:
    s = await _shop(client)
    cid = await _customer(client, s, name="Local Traders", phone="9000000004",
                          gstin=UP_CUSTOMER_GSTIN)
    await _sell(client, s, customer_id=cid)

    line = (await _gstr1(client, s))["b2b"][0]["lines"][0]
    assert Decimal(line["cgst"]) == Decimal("25.00")
    assert Decimal(line["sgst"]) == Decimal("25.00")
    assert Decimal(line["igst"]) == Decimal("0.00")


async def test_a_counter_sale_is_supplied_where_the_counter_is(
    client: AsyncClient,
) -> None:
    """Goods handed across a desk are supplied at the desk, whatever address
    the customer happened to give."""
    s = await _shop(client)
    await _sell(client, s)

    assert (await _gstr1(client, s))["b2cs"][0]["place_of_supply"] == "09"


# ---------------------------------------------------------------------------
# Credit notes — the sign
# ---------------------------------------------------------------------------


async def test_a_credit_note_is_reported_positive(client: AsyncClient) -> None:
    """THE ONE THAT MATTERS.

    Storage keeps returns negative so revenue aggregates net them out. The
    return reports them positive — it reduces the liability by BEING a credit
    note. Reporting a negative figure here deducts it twice.
    """
    s = await _shop(client)
    sale = await _sell(client, s)

    r = await client.get(f"/api/v1/sales/{sale['id']}/returnable", headers=s["h"])
    line = r.json()[0]
    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=s["h"], json={
        "lines": [{"sale_line_id": line["sale_line_id"], "quantity": "1"}],
        "reason": "wrong size",
        "refunds": [{"method": "cash", "amount": "1050.00"}]})
    assert r.status_code == 201, r.text

    body = await _gstr1(client, s)
    assert len(body["credit_notes"]) == 1
    note = body["credit_notes"][0]
    assert Decimal(note["note_value"]) == Decimal("1050.00")
    assert Decimal(note["lines"][0]["taxable_value"]) > 0
    assert note["original_invoice_number"] == sale["number"]


# ---------------------------------------------------------------------------
# HSN summary and warnings
# ---------------------------------------------------------------------------


async def test_the_hsn_summary_adds_up(client: AsyncClient) -> None:
    s = await _shop(client)
    await _sell(client, s, qty="3", amount="3150.00")

    body = await _gstr1(client, s)
    assert len(body["hsn"]) == 1
    row = body["hsn"][0]
    assert row["hsn_code"] == "5407"
    assert Decimal(row["quantity"]) == Decimal("3.000")
    assert Decimal(row["taxable_value"]) == Decimal("3000.00")


async def test_a_line_with_no_hsn_code_is_reported_not_dropped(
    client: AsyncClient,
) -> None:
    """The HSN section is mandatory. A line quietly missing from it means the
    return is filed short, and nobody knows until it is queried."""
    s = await _shop(client)
    r = await client.post("/api/v1/products", headers=s["h"], json={
        "name": "Loose cloth", "unit_id": s["unit_id"], "tax_rate": "5.00",
        "variants": [{"name": "1m", "sku": "GS-X", "cost_price": "100.00",
                      "mrp": "315.00", "selling_price": "315.00",
                      "reorder_point": "1.000", "reorder_quantity": "5.000"}]})
    no_hsn = r.json()["variants"][0]["id"]
    await client.post("/api/v1/inventory/adjust", headers=s["h"], json={
        "store_id": s["store_id"], "reason": "OPENING BALANCE",
        "lines": [{"variant_id": no_hsn, "delta": "10.000"}]})
    r = await client.post("/api/v1/sales", headers=s["h"], json={
        "store_id": s["store_id"],
        "lines": [{"variant_id": no_hsn, "quantity": "1"}],
        "payments": [{"method": "cash", "amount": "315.00"}]})
    assert r.status_code == 201, r.text

    body = await _gstr1(client, s)
    assert body["hsn"] == []
    assert any("HSN" in w for w in body["warnings"])


async def test_a_malformed_gstin_is_named(client: AsyncClient) -> None:
    """The portal will reject the row. The person filing needs to know which
    customer to fix, not merely that something is wrong."""
    s = await _shop(client)
    # Fifteen characters, so the customer form accepts it — but the middle is
    # letters where the GSTIN format demands digits. Exactly the shape of a
    # real mistyped number, which is the case worth catching.
    cid = await _customer(client, s, name="Typo Traders", phone="9000000005",
                          gstin="09NOTAGSTIN1Z99")
    await _sell(client, s, customer_id=cid)

    body = await _gstr1(client, s)
    assert any("Typo Traders" in w for w in body["warnings"])
    # And the sale is still in the return — it happened.
    assert len(body["b2b"]) == 1


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------


async def test_a_branch_with_no_gstin_cannot_produce_a_return(
    client: AsyncClient,
) -> None:
    """A return is filed against a GSTIN. Producing one without would hand
    over a document nobody can file, as though it were finished."""
    token = await login(client)
    h = auth(token)
    r = await client.post("/api/v1/stores", headers=h,
                          json={"code": "NG", "name": "No GST Mall"})
    store_id = r.json()["id"]

    r = await client.get(f"/api/v1/reports/gstr1?store_id={store_id}", headers=h)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "STORE_HAS_NO_GSTIN"


async def test_a_store_must_be_named(client: AsyncClient) -> None:
    """The two malls file separately. A combined figure is not a return."""
    s = await _shop(client)
    r = await client.get("/api/v1/reports/gstr1", headers=s["h"])
    assert r.status_code == 422, r.text


async def test_the_document_range_reports_the_real_first_and_last(
    client: AsyncClient,
) -> None:
    """A gap in an invoice series is the first thing an officer looks for."""
    s = await _shop(client)
    first = await _sell(client, s)
    await _sell(client, s)
    last = await _sell(client, s)

    body = await _gstr1(client, s)
    docs = next(d for d in body["documents"] if "Invoice" in d["document_type"])
    assert docs["from_number"] == first["number"]
    assert docs["to_number"] == last["number"]
    assert docs["total_count"] == 3


async def test_the_totals_tie_back_to_the_bills(client: AsyncClient) -> None:
    """The figure an accountant checks before anything is filed."""
    s = await _shop(client)
    await _sell(client, s)
    await _sell(client, s)

    body = await _gstr1(client, s)
    assert Decimal(body["total_invoice_value"]) == Decimal("2100.00")
    assert Decimal(body["total_taxable_value"]) == Decimal("2000.00")
    assert Decimal(body["total_tax"]) == Decimal("100.00")
