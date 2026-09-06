"""The three reports a shop owner actually asks for.

DAY BOOK — not "what did we sell" but "what should be in the drawer". The
distinction matters: a day of card sales inflates takings and changes the
drawer by nothing.

SALES BY brand / category / size / salesperson — one function, four columns.

ITEM PROFIT — margin from the cost SNAPSHOTTED on each line. The test that
matters most is `test_profit_reports_what_it_could_not_cost`: a margin that
silently covers half the period is worse than no margin at all.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login


async def _shop(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h,
                          json={"code": "RP", "name": "Report Mall"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/brands", headers=h, json={"name": "Raymond"})
    brand_id = r.json()["id"]
    r = await client.post("/api/v1/categories", headers=h, json={"name": "Shirts"})
    category_id = r.json()["id"]

    # Cost 400, sells 1000 — a clean 600 margin per unit.
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Kurta", "unit_id": unit_id, "tax_rate": "0.00",
        "brand_id": brand_id, "category_id": category_id,
        "variants": [
            {"name": "M", "sku": "RP-M", "cost_price": "400.00",
             "mrp": "1000.00", "selling_price": "1000.00",
             "reorder_point": "1.000", "reorder_quantity": "5.000"},
            {"name": "L", "sku": "RP-L", "cost_price": "500.00",
             "mrp": "1000.00", "selling_price": "1000.00",
             "reorder_point": "1.000", "reorder_quantity": "5.000"},
        ]})
    variants = [v["id"] for v in r.json()["variants"]]

    await client.post("/api/v1/day-sessions/open", headers=h,
                      json={"store_id": store_id, "opening_cash": "2000.00"})
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [
            {"variant_id": variants[0], "delta": "50.000"},
            {"variant_id": variants[1], "delta": "50.000"},
        ]})

    return {"h": h, "store_id": store_id, "brand_id": brand_id,
            "category_id": category_id, "m": variants[0], "l": variants[1]}


async def _sell(
    client: AsyncClient, s: dict, variant_id: str, qty: str, amount: str,
    method: str = "cash",
) -> dict:
    r = await client.post("/api/v1/sales", headers=s["h"], json={
        "store_id": s["store_id"],
        "lines": [{"variant_id": variant_id, "quantity": qty}],
        "payments": [{"method": method, "amount": amount}]})
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Item-wise profit
# ---------------------------------------------------------------------------


async def test_profit_uses_the_cost_recorded_at_the_time_of_sale(
    client: AsyncClient,
) -> None:
    s = await _shop(client)
    await _sell(client, s, s["m"], "2", "2000.00")

    r = await client.get("/api/v1/reports/item-profit", headers=s["h"])
    assert r.status_code == 200, r.text
    body = r.json()
    row = next(x for x in body["rows"] if x["sku"] == "RP-M")
    assert Decimal(row["revenue"]) == Decimal("2000.00")
    assert Decimal(row["cost"]) == Decimal("800.00")
    assert Decimal(row["profit"]) == Decimal("1200.00")
    assert Decimal(row["margin_pct"]) == Decimal("60.00")


async def test_changing_the_cost_price_does_not_restate_a_past_bill(
    client: AsyncClient,
) -> None:
    """THE REASON THE COST IS SNAPSHOTTED.

    A supplier raises their rate. Without the snapshot, re-running last
    month's report shows a different margin with nothing to explain the move,
    and a season's profit quietly changes.
    """
    s = await _shop(client)
    await _sell(client, s, s["m"], "1", "1000.00")

    r = await client.get("/api/v1/reports/item-profit", headers=s["h"])
    before = Decimal(next(x for x in r.json()["rows"] if x["sku"] == "RP-M")["profit"])

    # The supplier doubles their price.
    r = await client.patch(f"/api/v1/products/variants/{s['m']}", headers=s["h"],
                           json={"cost_price": "800.00"})
    assert r.status_code == 200, r.text

    r = await client.get("/api/v1/reports/item-profit", headers=s["h"])
    after = Decimal(next(x for x in r.json()["rows"] if x["sku"] == "RP-M")["profit"])
    assert after == before == Decimal("600.00")


async def test_profit_reports_what_it_could_not_cost(client: AsyncClient) -> None:
    """A margin covering half the period, presented as the whole, is worse
    than no margin at all.

    Lines written before costs were snapshotted carry none. Costing them at
    zero would report their entire revenue as profit — the most flattering
    possible lie — so they are excluded from the totals AND counted.
    """
    s = await _shop(client)
    sale = await _sell(client, s, s["m"], "1", "1000.00")

    # Simulate a historical line by clearing its cost, which is exactly the
    # state every bill written before migration 0028 is in.
    from sqlalchemy import text

    # Reached through the MODULE, not a from-import. conftest rebuilds the
    # engine and rebinds `SessionLocal` on the module object; a from-import
    # captures the original and writes to a database nobody is reading.
    from app.db import session as db_session_mod

    async with db_session_mod.SessionLocal() as db:
        # Matched on the hex form WITHOUT dashes: SQLAlchemy's Uuid type stores
        # a UUID as CHAR(32) on SQLite, so the dashed string from the JSON
        # response matches no row and the update silently does nothing.
        await db.execute(
            text("UPDATE sale_lines SET unit_cost = NULL WHERE sale_id = :sid"),
            {"sid": uuid.UUID(sale["id"]).hex},
        )
        await db.commit()

    r = await client.get("/api/v1/reports/item-profit", headers=s["h"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["uncosted_lines"] == 1
    assert Decimal(body["uncosted_revenue"]) == Decimal("1000.00")
    # And that revenue is NOT counted as pure profit.
    assert Decimal(body["total_profit"]) == Decimal("0")


async def test_a_return_reverses_the_margin_it_booked(client: AsyncClient) -> None:
    """A fully-returned bill must net to zero margin, not leave a phantom one
    behind because the credit note was costed at a different rate."""
    s = await _shop(client)
    sale = await _sell(client, s, s["m"], "1", "1000.00")

    r = await client.get(f"/api/v1/sales/{sale['id']}/returnable", headers=s["h"])
    line = r.json()[0]
    r = await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=s["h"], json={
        "lines": [{"sale_line_id": line["sale_line_id"], "quantity": "1"}],
        "reason": "changed mind",
        "refunds": [{"method": "cash", "amount": "1000.00"}]})
    assert r.status_code == 201, r.text

    r = await client.get("/api/v1/reports/item-profit", headers=s["h"])
    assert Decimal(r.json()["total_profit"]) == Decimal("0.00")
    assert Decimal(r.json()["total_revenue"]) == Decimal("0.00")


# ---------------------------------------------------------------------------
# Sales by a dimension
# ---------------------------------------------------------------------------


async def test_sales_split_by_brand_and_by_category(client: AsyncClient) -> None:
    s = await _shop(client)
    await _sell(client, s, s["m"], "1", "1000.00")

    for dimension, expected in (("brand", "Raymond"), ("category", "Shirts")):
        r = await client.get(
            f"/api/v1/reports/sales-by?dimension={dimension}", headers=s["h"])
        assert r.status_code == 200, r.text
        rows = r.json()
        assert rows[0]["label"] == expected, dimension
        assert Decimal(rows[0]["revenue"]) == Decimal("1000.00")
        assert Decimal(rows[0]["share_pct"]) == Decimal("100.00")


async def test_sales_split_by_size(client: AsyncClient) -> None:
    """The variant name IS the size in a garment shop."""
    s = await _shop(client)
    await _sell(client, s, s["m"], "1", "1000.00")
    await _sell(client, s, s["l"], "3", "3000.00")

    r = await client.get("/api/v1/reports/sales-by?dimension=size", headers=s["h"])
    assert r.status_code == 200, r.text
    rows = {row["label"]: row for row in r.json()}
    assert Decimal(rows["L"]["quantity_sold"]) == Decimal("3.000")
    assert Decimal(rows["M"]["quantity_sold"]) == Decimal("1.000")
    # Biggest first — a report nobody has to sort.
    assert r.json()[0]["label"] == "L"


async def test_an_unbranded_product_is_labelled_not_blank(
    client: AsyncClient,
) -> None:
    """A product with no brand is a real and common case. An unlabelled row in
    a report is one nobody can act on."""
    s = await _shop(client)
    r = await client.post("/api/v1/products", headers=s["h"], json={
        "name": "Loose cloth", "unit_id":
            (await client.get("/api/v1/units", headers=s["h"])).json()["items"][0]["id"],
        "tax_rate": "0.00",
        "variants": [{"name": "1m", "sku": "RP-X", "cost_price": "100.00",
                      "mrp": "300.00", "selling_price": "300.00",
                      "reorder_point": "1.000", "reorder_quantity": "5.000"}]})
    plain = r.json()["variants"][0]["id"]
    await client.post("/api/v1/inventory/adjust", headers=s["h"], json={
        "store_id": s["store_id"], "reason": "OPENING BALANCE",
        "lines": [{"variant_id": plain, "delta": "10.000"}]})
    await _sell(client, s, plain, "1", "300.00")

    r = await client.get("/api/v1/reports/sales-by?dimension=brand", headers=s["h"])
    labels = [row["label"] for row in r.json()]
    assert "Unassigned" in labels
    assert "" not in labels


async def test_an_unknown_dimension_is_refused(client: AsyncClient) -> None:
    s = await _shop(client)
    r = await client.get("/api/v1/reports/sales-by?dimension=colour", headers=s["h"])
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "UNKNOWN_BREAKDOWN"


# ---------------------------------------------------------------------------
# Day book
# ---------------------------------------------------------------------------


async def test_the_day_book_says_what_the_drawer_should_hold(
    client: AsyncClient,
) -> None:
    s = await _shop(client)
    await _sell(client, s, s["m"], "1", "1000.00", method="cash")

    r = await client.get(
        f"/api/v1/reports/day-book?store_id={s['store_id']}", headers=s["h"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert Decimal(body["opening_cash"]) == Decimal("2000.00")
    assert Decimal(body["cash_in"]) == Decimal("1000.00")
    assert Decimal(body["expected_cash"]) == Decimal("3000.00")


async def test_a_card_sale_changes_takings_and_not_the_drawer(
    client: AsyncClient,
) -> None:
    """THE DISTINCTION THIS REPORT EXISTS FOR. A day book that mixed cash with
    card could not answer the one question it is opened for."""
    s = await _shop(client)
    await _sell(client, s, s["m"], "1", "1000.00", method="card")

    r = await client.get(
        f"/api/v1/reports/day-book?store_id={s['store_id']}", headers=s["h"])
    body = r.json()
    assert Decimal(body["sales_total"]) == Decimal("1000.00")
    assert Decimal(body["cash_in"]) == Decimal("0")
    assert Decimal(body["expected_cash"]) == Decimal("2000.00")


async def test_a_cash_refund_comes_out_of_the_drawer(client: AsyncClient) -> None:
    s = await _shop(client)
    sale = await _sell(client, s, s["m"], "2", "2000.00", method="cash")

    r = await client.get(f"/api/v1/sales/{sale['id']}/returnable", headers=s["h"])
    line = r.json()[0]
    await client.post(f"/api/v1/sales/{sale['id']}/returns", headers=s["h"], json={
        "lines": [{"sale_line_id": line["sale_line_id"], "quantity": "1"}],
        "reason": "wrong size",
        "refunds": [{"method": "cash", "amount": "1000.00"}]})

    r = await client.get(
        f"/api/v1/reports/day-book?store_id={s['store_id']}", headers=s["h"])
    body = r.json()
    assert Decimal(body["returns_total"]) == Decimal("1000.00")
    assert Decimal(body["cash_out"]) == Decimal("1000.00")
    assert Decimal(body["expected_cash"]) == Decimal("3000.00")

    # A refund reads as money OUT. Both directions printed as positive would
    # need a legend, and this is the report nobody can afford to misread.
    refund = next(e for e in body["entries"] if e["kind"] == "return")
    assert Decimal(refund["amount"]) < 0


async def test_an_expense_leaves_the_drawer_too(client: AsyncClient) -> None:
    s = await _shop(client)
    await _sell(client, s, s["m"], "1", "1000.00", method="cash")

    r = await client.post("/api/v1/expenses/categories", headers=s["h"],
                          json={"code": "TEA", "name": "Tea"})
    category_id = r.json()["id"]
    # Dated on the SAME clock the report runs on. `expense_date` is a plain
    # calendar date a person types, while sales are UTC timestamps, and for
    # five and a half hours after midnight IST those disagree — see the seam
    # noted on ReportService.day_book.
    from datetime import datetime as _dt, timezone as _tz

    r = await client.post("/api/v1/expenses", headers=s["h"], json={
        "category_id": category_id, "store_id": s["store_id"],
        "expense_date": _dt.now(_tz.utc).date().isoformat(),
        "amount": "150.00", "payment_method": "cash",
        "description": "Chai for the counter"})
    assert r.status_code == 201, r.text

    r = await client.get(
        f"/api/v1/reports/day-book?store_id={s['store_id']}", headers=s["h"])
    body = r.json()
    assert Decimal(body["expenses_total"]) == Decimal("150.00")
    assert Decimal(body["expected_cash"]) == Decimal("2850.00")


async def test_a_credit_sale_is_not_money_in_the_drawer(
    client: AsyncClient,
) -> None:
    """A bill taken on credit moves goods and NO money.

    Reading grand totals instead of payments would put cash in the book that
    nobody ever handed over — and the drawer would come up short every time.
    """
    s = await _shop(client)
    r = await client.post("/api/v1/customers", headers=s["h"],
                          json={"name": "Khata customer", "phone": "9000000123"})
    customer_id = r.json()["id"]
    r = await client.post("/api/v1/sales", headers=s["h"], json={
        "store_id": s["store_id"], "customer_id": customer_id,
        "lines": [{"variant_id": s["m"], "quantity": "1"}],
        "payments": []})
    assert r.status_code == 201, r.text

    r = await client.get(
        f"/api/v1/reports/day-book?store_id={s['store_id']}", headers=s["h"])
    body = r.json()
    assert Decimal(body["cash_in"]) == Decimal("0")
    assert Decimal(body["expected_cash"]) == Decimal("2000.00")


async def test_no_day_session_means_no_expected_cash_rather_than_a_guess(
    client: AsyncClient,
) -> None:
    """"Never opened" and "opened with zero" are different facts. Inventing an
    opening figure would let a short drawer look balanced."""
    token = await login(client)
    h = auth(token)
    r = await client.post("/api/v1/stores", headers=h,
                          json={"code": "NS", "name": "No Session Mall"})
    store_id = r.json()["id"]

    r = await client.get(f"/api/v1/reports/day-book?store_id={store_id}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["opening_cash"] is None
    assert r.json()["expected_cash"] is None
