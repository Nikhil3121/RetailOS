"""Physical stock audit — counting the shelf and correcting the books.

THE GO-LIVE BLOCKER. The legacy import deliberately brought over products and
variants but NOT stock, because the old system's quantities could not be
trusted. Every variant reads zero until someone walks the floor with a sheet.

The test that matters most here is `test_a_count_posts_the_variance_not_the
_total`: a sheet filled in at 6pm and posted at 9pm has an evening of sales
inside it, and the naive implementation silently puts them all back.
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login


async def _shop(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h,
                          json={"code": "AU", "name": "Audit Mall"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Saree", "unit_id": unit_id, "tax_rate": "0.00",
        "variants": [
            {"name": "Red", "sku": "AU-1", "cost_price": "400.00",
             "mrp": "1000.00", "selling_price": "1000.00",
             "reorder_point": "1.000", "reorder_quantity": "5.000"},
            {"name": "Blue", "sku": "AU-2", "cost_price": "400.00",
             "mrp": "1000.00", "selling_price": "1000.00",
             "reorder_point": "1.000", "reorder_quantity": "5.000"},
        ]})
    variants = [v["id"] for v in r.json()["variants"]]

    await client.post("/api/v1/day-sessions/open", headers=h,
                      json={"store_id": store_id, "opening_cash": "0.00"})
    return {"h": h, "store_id": store_id,
            "variant_id": variants[0], "other_variant_id": variants[1]}


async def _stock(client: AsyncClient, h: dict, store_id: str, variant_id: str) -> Decimal:
    r = await client.get(f"/api/v1/inventory/levels?store_id={store_id}", headers=h)
    assert r.status_code == 200, r.text
    for row in r.json()["items"]:
        if row["variant_id"] == variant_id:
            return Decimal(str(row["quantity"]))
    return Decimal("0")


async def _open_count(client: AsyncClient, h: dict, store_id: str, **kw) -> str:
    r = await client.post("/api/v1/stock-counts", headers=h, json={
        "store_id": store_id, "reference": kw.pop("reference", "COUNT-1"),
        "scope": "Ground floor", **kw})
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------------------------------------------------------------------------
# The opening balance: the reason this feature exists
# ---------------------------------------------------------------------------


async def test_a_count_establishes_opening_stock_from_zero(client: AsyncClient) -> None:
    """Every variant starts at zero because legacy stock was never imported."""
    s = await _shop(client)
    assert await _stock(client, s["h"], s["store_id"], s["variant_id"]) == Decimal("0")

    count_id = await _open_count(client, s["h"], s["store_id"], is_blind=False)
    r = await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=s["h"], json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "42.000"}]})
    assert r.status_code == 200, r.text

    r = await client.post(f"/api/v1/stock-counts/{count_id}/post", headers=s["h"])
    assert r.status_code == 200, r.text
    assert r.json()["movements_posted"] == 1

    assert await _stock(client, s["h"], s["store_id"], s["variant_id"]) == Decimal("42.000")


async def test_a_count_posts_the_variance_not_the_total(client: AsyncClient) -> None:
    """The sheet is counted at 6pm and posted at 9pm. Sales happen in between.

    THE BUG THIS EXISTS TO PREVENT: posting "set the balance to 40" would put
    the 5 units sold that evening straight back on the shelf, overstating
    stock by exactly the evening's takings with nothing in the ledger to say
    so. The sheet found 2 missing; 2 is what it must correct.
    """
    s = await _shop(client)
    h = s["h"]

    # Books say 50.
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": s["store_id"], "reason": "OPENING BALANCE",
        "lines": [{"variant_id": s["variant_id"], "delta": "50.000"}]})

    # 6pm: the shelf holds 48. Two are missing.
    count_id = await _open_count(client, h, s["store_id"], is_blind=False)
    r = await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=h, json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "48.000",
                   "reason": "2 unaccounted"}]})
    assert r.status_code == 200, r.text
    assert Decimal(r.json()["lines"][0]["variance"]) == Decimal("-2.000")

    # 6pm–9pm: five more are sold.
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": s["store_id"], "reason": "evening sales",
        "lines": [{"variant_id": s["variant_id"], "delta": "-5.000"}]})
    assert await _stock(client, h, s["store_id"], s["variant_id"]) == Decimal("45.000")

    # 9pm: post. 45 − 2 = 43, NOT the counted 48.
    r = await client.post(f"/api/v1/stock-counts/{count_id}/post", headers=h)
    assert r.status_code == 200, r.text
    assert await _stock(client, h, s["store_id"], s["variant_id"]) == Decimal("43.000")


async def test_posting_reports_the_lines_that_moved_while_being_counted(
    client: AsyncClient,
) -> None:
    """Not an error — but a manager reviewing a discrepancy deserves to know
    the shelf was being sold from while it was counted."""
    s = await _shop(client)
    h = s["h"]
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": s["store_id"], "reason": "OPENING BALANCE",
        "lines": [{"variant_id": s["variant_id"], "delta": "10.000"}]})

    count_id = await _open_count(client, h, s["store_id"], is_blind=False)
    await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=h, json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "9.000"}]})

    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": s["store_id"], "reason": "sold one",
        "lines": [{"variant_id": s["variant_id"], "delta": "-1.000"}]})

    r = await client.post(f"/api/v1/stock-counts/{count_id}/post", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["drifted_variant_ids"] == [s["variant_id"]]


async def test_an_uncounted_item_is_never_zeroed(client: AsyncClient) -> None:
    """A partial count of the sarees must not write off the shirts.

    "We did not look at it" and "there are none" are different facts, and
    conflating them destroys an entire inventory in one click.
    """
    s = await _shop(client)
    h = s["h"]
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": s["store_id"], "reason": "OPENING BALANCE",
        "lines": [
            {"variant_id": s["variant_id"], "delta": "10.000"},
            {"variant_id": s["other_variant_id"], "delta": "7.000"},
        ]})

    count_id = await _open_count(client, h, s["store_id"], is_blind=False)
    await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=h, json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "10.000"}]})
    await client.post(f"/api/v1/stock-counts/{count_id}/post", headers=h)

    assert await _stock(client, h, s["store_id"], s["other_variant_id"]) == Decimal("7.000")


async def test_a_matching_line_writes_no_ledger_row(client: AsyncClient) -> None:
    """Zero variance is not a movement. An empty ledger row says something
    happened when nothing did, and every one of them makes an audit harder."""
    s = await _shop(client)
    h = s["h"]
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": s["store_id"], "reason": "OPENING BALANCE",
        "lines": [{"variant_id": s["variant_id"], "delta": "10.000"}]})

    count_id = await _open_count(client, h, s["store_id"], is_blind=False)
    await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=h, json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "10.000"}]})

    r = await client.post(f"/api/v1/stock-counts/{count_id}/post", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["movements_posted"] == 0
    assert Decimal(r.json()["net_variance"]) == Decimal("0")


# ---------------------------------------------------------------------------
# Blind counting
# ---------------------------------------------------------------------------


async def test_a_blind_count_withholds_the_expected_figure(client: AsyncClient) -> None:
    """Shown the number they are supposed to find, a tired person writes it
    down instead of counting. Withheld from the PAYLOAD, not just the screen —
    hiding it in the UI while shipping it in the JSON is theatre."""
    s = await _shop(client)
    h = s["h"]
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": s["store_id"], "reason": "OPENING BALANCE",
        "lines": [{"variant_id": s["variant_id"], "delta": "10.000"}]})

    count_id = await _open_count(client, h, s["store_id"], is_blind=True)
    r = await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=h, json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "8.000"}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["lines"][0]["system_qty"] is None
    assert body["lines"][0]["variance"] is None
    assert body["net_variance"] is None
    # What was counted is never hidden — the counter typed it.
    assert Decimal(body["lines"][0]["counted_qty"]) == Decimal("8.000")


async def test_posting_releases_the_figures_a_manager_must_review(
    client: AsyncClient,
) -> None:
    """Blind protects the count, not the audit. Once posted, the variance IS
    the record of a write-off and has to be readable."""
    s = await _shop(client)
    h = s["h"]
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": s["store_id"], "reason": "OPENING BALANCE",
        "lines": [{"variant_id": s["variant_id"], "delta": "10.000"}]})

    count_id = await _open_count(client, h, s["store_id"], is_blind=True)
    await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=h, json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "8.000"}]})
    await client.post(f"/api/v1/stock-counts/{count_id}/post", headers=h)

    r = await client.get(f"/api/v1/stock-counts/{count_id}", headers=h)
    assert r.status_code == 200, r.text
    assert Decimal(r.json()["lines"][0]["variance"]) == Decimal("-2.000")
    assert Decimal(r.json()["net_variance"]) == Decimal("-2.000")


# ---------------------------------------------------------------------------
# Sheet lifecycle
# ---------------------------------------------------------------------------


async def test_recounting_an_item_replaces_its_line(client: AsyncClient) -> None:
    """A counter who finds a missed box re-enters the rack. Two rows for one
    variant would post the variance twice."""
    s = await _shop(client)
    h = s["h"]
    count_id = await _open_count(client, h, s["store_id"], is_blind=False)

    await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=h, json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "5.000"}]})
    r = await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=h, json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "9.000"}]})
    assert r.status_code == 200, r.text
    assert len(r.json()["lines"]) == 1
    assert Decimal(r.json()["lines"][0]["counted_qty"]) == Decimal("9.000")

    await client.post(f"/api/v1/stock-counts/{count_id}/post", headers=h)
    assert await _stock(client, h, s["store_id"], s["variant_id"]) == Decimal("9.000")


async def test_a_posted_count_cannot_be_posted_again(client: AsyncClient) -> None:
    """Re-posting would apply the same variance twice, and the ledger rows it
    already wrote cannot be unwritten."""
    s = await _shop(client)
    h = s["h"]
    count_id = await _open_count(client, h, s["store_id"], is_blind=False)
    await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=h, json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "5.000"}]})
    await client.post(f"/api/v1/stock-counts/{count_id}/post", headers=h)

    r = await client.post(f"/api/v1/stock-counts/{count_id}/post", headers=h)
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "STOCK_COUNT_POSTED"
    # And the stock did not move a second time.
    assert await _stock(client, h, s["store_id"], s["variant_id"]) == Decimal("5.000")


async def test_a_posted_count_cannot_be_edited_or_deleted(client: AsyncClient) -> None:
    """It is the record behind stock movements that still exist."""
    s = await _shop(client)
    h = s["h"]
    count_id = await _open_count(client, h, s["store_id"], is_blind=False)
    await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=h, json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "5.000"}]})
    await client.post(f"/api/v1/stock-counts/{count_id}/post", headers=h)

    r = await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=h, json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "99.000"}]})
    assert r.status_code == 409, r.text

    r = await client.delete(f"/api/v1/stock-counts/{count_id}", headers=h)
    assert r.status_code == 409, r.text


async def test_a_cancelled_sheet_touches_no_stock(client: AsyncClient) -> None:
    s = await _shop(client)
    h = s["h"]
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": s["store_id"], "reason": "OPENING BALANCE",
        "lines": [{"variant_id": s["variant_id"], "delta": "10.000"}]})

    count_id = await _open_count(client, h, s["store_id"], is_blind=False)
    await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=h, json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "3.000"}]})
    r = await client.post(f"/api/v1/stock-counts/{count_id}/cancel", headers=h)
    assert r.status_code == 200, r.text

    assert await _stock(client, h, s["store_id"], s["variant_id"]) == Decimal("10.000")
    r = await client.post(f"/api/v1/stock-counts/{count_id}/post", headers=h)
    assert r.status_code == 409, r.text


async def test_an_empty_sheet_is_refused(client: AsyncClient) -> None:
    """Posting nothing is almost always a sheet somebody forgot to fill in."""
    s = await _shop(client)
    count_id = await _open_count(client, s["h"], s["store_id"], is_blind=False)
    r = await client.post(f"/api/v1/stock-counts/{count_id}/post", headers=s["h"])
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "STOCK_COUNT_EMPTY"


async def test_two_sheets_cannot_share_a_reference_at_one_store(
    client: AsyncClient,
) -> None:
    s = await _shop(client)
    await _open_count(client, s["h"], s["store_id"], reference="COUNT-DUP")
    r = await client.post("/api/v1/stock-counts", headers=s["h"], json={
        "store_id": s["store_id"], "reference": "COUNT-DUP"})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "STOCK_COUNT_REFERENCE_TAKEN"


async def test_counting_an_unknown_item_is_refused_by_name(client: AsyncClient) -> None:
    """A scanner that reads a barcode from another shop must not create a
    phantom line — and the operator has to be told which one."""
    s = await _shop(client)
    count_id = await _open_count(client, s["h"], s["store_id"])
    ghost = "11111111-1111-4111-8111-111111111111"
    r = await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=s["h"], json={
        "lines": [{"variant_id": ghost, "counted_qty": "1.000"}]})
    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "VARIANT_NOT_FOUND"


async def test_a_negative_count_is_refused(client: AsyncClient) -> None:
    """A shelf cannot hold −2 of anything."""
    s = await _shop(client)
    count_id = await _open_count(client, s["h"], s["store_id"])
    r = await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=s["h"], json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "-2.000"}]})
    assert r.status_code == 422, r.text


async def test_a_line_entered_by_mistake_can_be_removed(client: AsyncClient) -> None:
    s = await _shop(client)
    h = s["h"]
    count_id = await _open_count(client, h, s["store_id"], is_blind=False)
    r = await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=h, json={
        "lines": [
            {"variant_id": s["variant_id"], "counted_qty": "5.000"},
            {"variant_id": s["other_variant_id"], "counted_qty": "6.000"},
        ]})
    line_id = r.json()["lines"][0]["id"]

    r = await client.delete(
        f"/api/v1/stock-counts/{count_id}/lines/{line_id}", headers=h)
    assert r.status_code == 200, r.text
    assert len(r.json()["lines"]) == 1


# ---------------------------------------------------------------------------
# Negative stock — what a count exposes, and how anyone finds it afterwards
# ---------------------------------------------------------------------------


async def test_a_count_may_drive_stock_negative_and_says_so(
    client: AsyncClient,
) -> None:
    """The count IS the physical truth, so it is never blocked.

    Books say 3, the shelf holds 0, and 2 more are sold before the sheet is
    posted. The honest balance is −2 and the shop needs to SEE that. Refusing
    the post would leave the books saying 1 with nothing on the shelf, which
    is the same error hidden.
    """
    s = await _shop(client)
    h = s["h"]
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": s["store_id"], "reason": "OPENING BALANCE",
        "lines": [{"variant_id": s["variant_id"], "delta": "3.000"}]})

    count_id = await _open_count(client, h, s["store_id"], is_blind=False)
    await client.put(f"/api/v1/stock-counts/{count_id}/lines", headers=h, json={
        "lines": [{"variant_id": s["variant_id"], "counted_qty": "0.000"}]})

    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": s["store_id"], "reason": "sold two more",
        "lines": [{"variant_id": s["variant_id"], "delta": "-2.000"}]})

    r = await client.post(f"/api/v1/stock-counts/{count_id}/post", headers=h)
    assert r.status_code == 200, r.text
    assert await _stock(client, h, s["store_id"], s["variant_id"]) == Decimal("-2.000")


async def test_the_negative_report_separates_broken_books_from_empty_shelves(
    client: AsyncClient,
) -> None:
    """A zero means "we have none". A negative means the books are wrong.

    `out_of_stock` uses <= 0 and therefore buries negatives among the empty
    rows, which is exactly why they went unnoticed.
    """
    s = await _shop(client)
    h = s["h"]
    # One variant driven negative, one simply empty.
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": s["store_id"], "reason": "OPENING correction",
        "lines": [{"variant_id": s["variant_id"], "delta": "-4.000"}]})

    r = await client.get(
        f"/api/v1/inventory/levels?store_id={s['store_id']}&stock_filter=negative",
        headers=h)
    assert r.status_code == 200, r.text
    rows = r.json()["items"]
    assert [row["variant_id"] for row in rows] == [s["variant_id"]]
    assert Decimal(rows[0]["quantity"]) == Decimal("-4.000")
    # The merely-empty variant is NOT a data problem and must not be listed.
    assert s["other_variant_id"] not in [row["variant_id"] for row in rows]


async def test_the_negative_report_puts_the_worst_first(client: AsyncClient) -> None:
    """A manager working this list is triaging. −40 matters more than −1, and
    alphabetical order would bury it."""
    s = await _shop(client)
    h = s["h"]
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": s["store_id"], "reason": "OPENING correction",
        "lines": [
            {"variant_id": s["variant_id"], "delta": "-1.000"},
            {"variant_id": s["other_variant_id"], "delta": "-40.000"},
        ]})

    r = await client.get(
        f"/api/v1/inventory/levels?store_id={s['store_id']}&stock_filter=negative",
        headers=h)
    assert r.status_code == 200, r.text
    quantities = [Decimal(row["quantity"]) for row in r.json()["items"]]
    assert quantities == [Decimal("-40.000"), Decimal("-1.000")]
