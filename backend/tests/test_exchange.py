"""Swapping goods for other goods in one action.

Wrong size is the commonest reason a customer walks back into a garment shop,
and the counter's answer is never "here is your money" — it is "take the large
instead". Done as two separate operations the cashier refunds cash out of the
drawer and takes most of it straight back in: slower, wrong in the day book,
and two unlinked documents if anything interrupts the pair.

THE PROPERTY THESE TESTS PROTECT
An exchange produces TWO documents at their TRUE values — a credit note for
what came back, a full-value invoice for what went out — settled by a
credit-note tender rather than netted into one discounted bill. Netting would
understate the invoice, misstate its GST, and leave the return unrecorded.
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login


async def _shop(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h,
                          json={"code": "EX", "name": "Exchange Mall"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Kurta", "unit_id": unit_id, "tax_rate": "0.00",
        "variants": [
            {"name": "M", "sku": "EX-M", "cost_price": "400.00",
             "mrp": "1000.00", "selling_price": "1000.00",
             "reorder_point": "1.000", "reorder_quantity": "5.000"},
            {"name": "L", "sku": "EX-L", "cost_price": "400.00",
             "mrp": "1000.00", "selling_price": "1000.00",
             "reorder_point": "1.000", "reorder_quantity": "5.000"},
            {"name": "XL", "sku": "EX-XL", "cost_price": "600.00",
             "mrp": "1500.00", "selling_price": "1500.00",
             "reorder_point": "1.000", "reorder_quantity": "5.000"},
        ]})
    v = {x["sku"]: x["id"] for x in r.json()["variants"]}

    await client.post("/api/v1/day-sessions/open", headers=h,
                      json={"store_id": store_id, "opening_cash": "1000.00"})
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": i, "delta": "20.000"} for i in v.values()]})

    # The original purchase: one medium kurta at 1000.
    r = await client.post("/api/v1/sales", headers=h, json={
        "store_id": store_id,
        "lines": [{"variant_id": v["EX-M"], "quantity": "1"}],
        "payments": [{"method": "cash", "amount": "1000.00"}]})
    assert r.status_code == 201, r.text
    sale = r.json()

    return {"h": h, "store_id": store_id, "v": v, "sale": sale,
            "line_id": sale["lines"][0]["id"]}


async def _levels(client: AsyncClient, s: dict) -> dict:
    r = await client.get(
        f"/api/v1/inventory/levels?store_id={s['store_id']}", headers=s["h"])
    return {row["sku"]: Decimal(str(row["quantity"])) for row in r.json()["items"]}


async def test_an_even_swap_takes_no_money(client: AsyncClient) -> None:
    """Medium for large, same price. The customer pays nothing and is owed
    nothing — which is exactly what makes this worth one action."""
    s = await _shop(client)

    r = await client.post(f"/api/v1/sales/{s['sale']['id']}/exchange", headers=s["h"], json={
        "lines": [{"sale_line_id": s["line_id"], "quantity": "1"}],
        "new_lines": [{"variant_id": s["v"]["EX-L"], "quantity": "1"}],
        "reason": "wrong size"})
    assert r.status_code == 201, r.text
    body = r.json()

    assert Decimal(body["credit_applied"]) == Decimal("1000.00")
    assert Decimal(body["balance_due"]) == Decimal("0.00")
    assert Decimal(body["credit_remaining"]) == Decimal("0.00")


async def test_both_documents_keep_their_true_value(client: AsyncClient) -> None:
    """THE PROPERTY THIS FEATURE EXISTS TO PRESERVE.

    A ₹1,000 credit note and a ₹1,000 invoice — not one ₹0 bill. Netting them
    would understate the invoice, misstate its GST, and leave the returned
    goods with no document at all.
    """
    s = await _shop(client)

    r = await client.post(f"/api/v1/sales/{s['sale']['id']}/exchange", headers=s["h"], json={
        "lines": [{"sale_line_id": s["line_id"], "quantity": "1"}],
        "new_lines": [{"variant_id": s["v"]["EX-L"], "quantity": "1"}],
        "reason": "wrong size"})
    body = r.json()

    assert body["credit_note"]["doc_type"] == "return"
    assert Decimal(body["credit_note"]["grand_total"]) == Decimal("-1000.00")
    assert body["sale"]["doc_type"] == "sale"
    assert Decimal(body["sale"]["grand_total"]) == Decimal("1000.00")
    # Separate GST series, so each is a document in its own right.
    assert body["credit_note"]["number"] != body["sale"]["number"]


async def test_the_credit_is_a_tender_not_a_discount(client: AsyncClient) -> None:
    """Recorded on the invoice as how it was settled, carrying the credit
    note's number — otherwise the two documents are linked only by the
    customer's memory."""
    s = await _shop(client)

    r = await client.post(f"/api/v1/sales/{s['sale']['id']}/exchange", headers=s["h"], json={
        "lines": [{"sale_line_id": s["line_id"], "quantity": "1"}],
        "new_lines": [{"variant_id": s["v"]["EX-L"], "quantity": "1"}],
        "reason": "wrong size"})
    body = r.json()

    payment = body["sale"]["payments"][0]
    assert payment["method"] == "credit_note"
    assert Decimal(payment["amount"]) == Decimal("1000.00")
    assert payment["reference"] == body["credit_note"]["number"]
    # And no discount was invented to make the numbers work.
    assert Decimal(body["sale"]["discount_total"]) == Decimal("0.00")


async def test_upgrading_collects_the_difference(client: AsyncClient) -> None:
    """Medium (1000) for XL (1500) — the customer pays 500."""
    s = await _shop(client)

    r = await client.post(f"/api/v1/sales/{s['sale']['id']}/exchange", headers=s["h"], json={
        "lines": [{"sale_line_id": s["line_id"], "quantity": "1"}],
        "new_lines": [{"variant_id": s["v"]["EX-XL"], "quantity": "1"}],
        "payments": [{"method": "cash", "amount": "500.00"}],
        "reason": "wanted the bigger one"})
    assert r.status_code == 201, r.text
    body = r.json()

    assert Decimal(body["sale"]["grand_total"]) == Decimal("1500.00")
    assert Decimal(body["credit_applied"]) == Decimal("1000.00")
    assert Decimal(body["balance_due"]) == Decimal("0.00")
    assert Decimal(body["sale"]["paid_total"]) == Decimal("1500.00")


async def test_an_unpaid_difference_becomes_a_balance_not_a_silent_write_off(
    client: AsyncClient,
) -> None:
    """The customer walks out owing 500. That has to be recorded as owed, not
    quietly absorbed."""
    s = await _shop(client)

    r = await client.post(f"/api/v1/sales/{s['sale']['id']}/exchange", headers=s["h"], json={
        "lines": [{"sale_line_id": s["line_id"], "quantity": "1"}],
        "new_lines": [{"variant_id": s["v"]["EX-XL"], "quantity": "1"}],
        "reason": "will pay later"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert Decimal(body["balance_due"]) == Decimal("500.00")
    assert Decimal(body["sale"]["balance_due"]) == Decimal("500.00")


async def test_downgrading_leaves_credit_rather_than_pushing_cash_out(
    client: AsyncClient,
) -> None:
    """XL back, medium out — the shop owes 500.

    With no refund method given the excess stays on the credit note for the
    customer to spend later. That is the safer default: money never leaves the
    drawer unless somebody asked for it.
    """
    s = await _shop(client)
    # Buy the XL first so there is something dearer to bring back.
    r = await client.post("/api/v1/sales", headers=s["h"], json={
        "store_id": s["store_id"],
        "lines": [{"variant_id": s["v"]["EX-XL"], "quantity": "1"}],
        "payments": [{"method": "cash", "amount": "1500.00"}]})
    big = r.json()

    r = await client.post(f"/api/v1/sales/{big['id']}/exchange", headers=s["h"], json={
        "lines": [{"sale_line_id": big["lines"][0]["id"], "quantity": "1"}],
        "new_lines": [{"variant_id": s["v"]["EX-M"], "quantity": "1"}],
        "reason": "too big"})
    assert r.status_code == 201, r.text
    body = r.json()

    assert Decimal(body["credit_applied"]) == Decimal("1000.00")
    assert Decimal(body["credit_remaining"]) == Decimal("500.00")
    # Nothing was refunded, so the credit note shows no money paid out.
    assert Decimal(body["credit_note"]["paid_total"]) == Decimal("0.00")


async def test_the_excess_is_refunded_when_the_counter_asks(
    client: AsyncClient,
) -> None:
    """And it is recorded on the CREDIT NOTE, not the invoice — a refund
    against the new bill would make that bill look partly reversed."""
    s = await _shop(client)
    r = await client.post("/api/v1/sales", headers=s["h"], json={
        "store_id": s["store_id"],
        "lines": [{"variant_id": s["v"]["EX-XL"], "quantity": "1"}],
        "payments": [{"method": "cash", "amount": "1500.00"}]})
    big = r.json()

    r = await client.post(f"/api/v1/sales/{big['id']}/exchange", headers=s["h"], json={
        "lines": [{"sale_line_id": big["lines"][0]["id"], "quantity": "1"}],
        "new_lines": [{"variant_id": s["v"]["EX-M"], "quantity": "1"}],
        "refund_excess_method": "cash",
        "reason": "too big"})
    assert r.status_code == 201, r.text
    body = r.json()

    assert Decimal(body["credit_remaining"]) == Decimal("0.00")
    refund = next(
        p for p in body["credit_note"]["payments"] if p["method"] == "cash")
    # Credit notes store money negative; a refund is money leaving.
    assert Decimal(refund["amount"]) == Decimal("-500.00")
    # The invoice itself is untouched by the refund.
    assert all(p["method"] != "cash" for p in body["sale"]["payments"])


async def test_stock_moves_both_ways_in_one_action(client: AsyncClient) -> None:
    """The returned item goes back on the shelf and the replacement comes off
    it. Either half alone leaves the shop's stock wrong."""
    s = await _shop(client)
    before = await _levels(client, s)

    r = await client.post(f"/api/v1/sales/{s['sale']['id']}/exchange", headers=s["h"], json={
        "lines": [{"sale_line_id": s["line_id"], "quantity": "1"}],
        "new_lines": [{"variant_id": s["v"]["EX-L"], "quantity": "1"}],
        "reason": "wrong size"})
    assert r.status_code == 201, r.text

    after = await _levels(client, s)
    assert after["EX-M"] == before["EX-M"] + 1
    assert after["EX-L"] == before["EX-L"] - 1


async def test_an_exchange_never_over_tenders(client: AsyncClient) -> None:
    """Credit plus cash cannot exceed the bill. Allowed through, it would sit
    on the invoice as change nobody handed over."""
    s = await _shop(client)

    r = await client.post(f"/api/v1/sales/{s['sale']['id']}/exchange", headers=s["h"], json={
        "lines": [{"sale_line_id": s["line_id"], "quantity": "1"}],
        "new_lines": [{"variant_id": s["v"]["EX-L"], "quantity": "1"}],
        "payments": [{"method": "cash", "amount": "500.00"}],
        "reason": "confused"})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "EXCHANGE_OVERPAID"


async def test_the_returned_goods_cannot_be_returned_twice(
    client: AsyncClient,
) -> None:
    """The exchange consumed the line's returnable quantity, exactly as a
    plain return would. Otherwise one kurta could be credited repeatedly."""
    s = await _shop(client)

    r = await client.post(f"/api/v1/sales/{s['sale']['id']}/exchange", headers=s["h"], json={
        "lines": [{"sale_line_id": s["line_id"], "quantity": "1"}],
        "new_lines": [{"variant_id": s["v"]["EX-L"], "quantity": "1"}],
        "reason": "wrong size"})
    assert r.status_code == 201, r.text

    r = await client.get(
        f"/api/v1/sales/{s['sale']['id']}/returnable", headers=s["h"])
    assert all(Decimal(l["returnable_quantity"]) == 0 for l in r.json())

    r = await client.post(f"/api/v1/sales/{s['sale']['id']}/returns", headers=s["h"], json={
        "lines": [{"sale_line_id": s["line_id"], "quantity": "1"}],
        "reason": "again"})
    assert r.status_code in (409, 422), r.text


async def test_a_credit_note_tender_is_not_cash_in_the_day_book(
    client: AsyncClient,
) -> None:
    """Nothing left or entered the drawer. A day book that counted the credit
    as cash would report a drawer that does not exist."""
    s = await _shop(client)

    r = await client.get(
        f"/api/v1/reports/day-book?store_id={s['store_id']}", headers=s["h"])
    cash_before = Decimal(r.json()["cash_in"])

    await client.post(f"/api/v1/sales/{s['sale']['id']}/exchange", headers=s["h"], json={
        "lines": [{"sale_line_id": s["line_id"], "quantity": "1"}],
        "new_lines": [{"variant_id": s["v"]["EX-L"], "quantity": "1"}],
        "reason": "wrong size"})

    r = await client.get(
        f"/api/v1/reports/day-book?store_id={s['store_id']}", headers=s["h"])
    assert Decimal(r.json()["cash_in"]) == cash_before
