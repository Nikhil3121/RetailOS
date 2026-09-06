"""Moving stock between the two branches.

Both malls now run RetailOS for everything, and stock genuinely moves between
them — an MS1 saree is carried to MS2 and sold there. Until now that happened
entirely off the books: in eight months of the outgoing system, exactly one of
sixty-six challans was a real store-to-store transfer.

`POST /inventory/transfer` existed with NO tests. These are them. What they
pin is the property the whole feature turns on:

    NOTHING IS CREATED AND NOTHING IS DESTROYED.

A transfer is a move. Whatever leaves MS1 arrives at MS2, exactly, and the two
legs are linked so the pair can never be read as two unrelated adjustments.
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login


async def _two_malls(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h,
                          json={"code": "MS1", "name": "MS MALL"})
    ms1 = r.json()["id"]
    r = await client.post("/api/v1/stores", headers=h,
                          json={"code": "MS3", "name": "MS MALL 2"})
    ms2 = r.json()["id"]

    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]

    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Cotton Saree", "unit_id": unit_id, "tax_rate": "5.00",
        "variants": [
            {"name": "Red", "sku": "300100", "cost_price": "620.00",
             "mrp": "1128.00", "selling_price": "806.00",
             "reorder_point": "1.000", "reorder_quantity": "5.000"},
            {"name": "Blue", "sku": "300101", "cost_price": "620.00",
             "mrp": "1128.00", "selling_price": "806.00",
             "reorder_point": "1.000", "reorder_quantity": "5.000"},
        ]})
    variants = [v["id"] for v in r.json()["variants"]]

    # 20 of each land at MS1. MS2 starts with nothing.
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": ms1, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": v, "delta": "20.000"} for v in variants]})

    return {"h": h, "token": token, "ms1": ms1, "ms2": ms2,
            "v1": variants[0], "v2": variants[1]}


async def _stock(client: AsyncClient, shop: dict, store_id: str, variant_id: str) -> Decimal:
    r = await client.get(f"/api/v1/inventory/levels?store_id={store_id}",
                         headers=shop["h"])
    for row in r.json()["items"]:
        if row["variant_id"] == variant_id:
            return Decimal(row["quantity"])
    return Decimal("0")


# ---------------------------------------------------------------------------
# The move
# ---------------------------------------------------------------------------


async def test_stock_leaves_one_mall_and_arrives_at_the_other(client: AsyncClient) -> None:
    shop = await _two_malls(client)

    r = await client.post("/api/v1/inventory/transfer", headers=shop["h"], json={
        "from_store_id": shop["ms1"], "to_store_id": shop["ms2"],
        "reason": "Sent with Raju",
        "lines": [{"variant_id": shop["v1"], "delta": "8.000"}]})
    assert r.status_code == 201, r.text

    assert await _stock(client, shop, shop["ms1"], shop["v1"]) == Decimal("12.000")
    assert await _stock(client, shop, shop["ms2"], shop["v1"]) == Decimal("8.000")


async def test_nothing_is_created_or_destroyed(client: AsyncClient) -> None:
    """The total across both malls is identical before and after."""
    shop = await _two_malls(client)
    before = (
        await _stock(client, shop, shop["ms1"], shop["v1"])
        + await _stock(client, shop, shop["ms2"], shop["v1"])
    )

    await client.post("/api/v1/inventory/transfer", headers=shop["h"], json={
        "from_store_id": shop["ms1"], "to_store_id": shop["ms2"],
        "lines": [{"variant_id": shop["v1"], "delta": "13.000"}]})

    after = (
        await _stock(client, shop, shop["ms1"], shop["v1"])
        + await _stock(client, shop, shop["ms2"], shop["v1"])
    )
    assert before == after == Decimal("20.000")


async def test_several_items_move_together(client: AsyncClient) -> None:
    shop = await _two_malls(client)

    r = await client.post("/api/v1/inventory/transfer", headers=shop["h"], json={
        "from_store_id": shop["ms1"], "to_store_id": shop["ms2"],
        "lines": [
            {"variant_id": shop["v1"], "delta": "5.000"},
            {"variant_id": shop["v2"], "delta": "3.000"},
        ]})
    assert r.status_code == 201, r.text

    assert await _stock(client, shop, shop["ms2"], shop["v1"]) == Decimal("5.000")
    assert await _stock(client, shop, shop["ms2"], shop["v2"]) == Decimal("3.000")
    assert await _stock(client, shop, shop["ms1"], shop["v1"]) == Decimal("15.000")
    assert await _stock(client, shop, shop["ms1"], shop["v2"]) == Decimal("17.000")


async def test_both_legs_share_one_reference(client: AsyncClient) -> None:
    """Out and In must be readable as ONE movement, not two adjustments.

    Without a shared reference nobody can answer "where did those eight sarees
    go", which is the only question anyone asks about a transfer.
    """
    shop = await _two_malls(client)
    r = await client.post("/api/v1/inventory/transfer", headers=shop["h"], json={
        "from_store_id": shop["ms1"], "to_store_id": shop["ms2"],
        "lines": [{"variant_id": shop["v1"], "delta": "8.000"}]})
    movements = r.json()

    assert len(movements) == 2
    kinds = {m["kind"] for m in movements}
    assert kinds == {"transfer_out", "transfer_in"}
    refs = {m["reference_id"] for m in movements}
    assert len(refs) == 1, "both legs carry the same transfer id"
    assert all(m["reference_type"] == "transfer" for m in movements)


async def test_the_reason_is_recorded_on_both_legs(client: AsyncClient) -> None:
    shop = await _two_malls(client)
    r = await client.post("/api/v1/inventory/transfer", headers=shop["h"], json={
        "from_store_id": shop["ms1"], "to_store_id": shop["ms2"],
        "reason": "Sent with Raju",
        "lines": [{"variant_id": shop["v1"], "delta": "2.000"}]})
    assert all(m["reason"] == "Sent with Raju" for m in r.json())


# ---------------------------------------------------------------------------
# Refusals
# ---------------------------------------------------------------------------


async def test_a_mall_cannot_transfer_to_itself(client: AsyncClient) -> None:
    shop = await _two_malls(client)
    r = await client.post("/api/v1/inventory/transfer", headers=shop["h"], json={
        "from_store_id": shop["ms1"], "to_store_id": shop["ms1"],
        "lines": [{"variant_id": shop["v1"], "delta": "5.000"}]})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "TRANSFER_SAME_STORE"


async def test_quantities_must_be_positive(client: AsyncClient) -> None:
    """A negative line would move stock the wrong way while reading as a send."""
    shop = await _two_malls(client)
    r = await client.post("/api/v1/inventory/transfer", headers=shop["h"], json={
        "from_store_id": shop["ms1"], "to_store_id": shop["ms2"],
        "lines": [{"variant_id": shop["v1"], "delta": "-5.000"}]})
    assert r.status_code == 422, r.text


async def test_an_unknown_destination_is_refused(client: AsyncClient) -> None:
    shop = await _two_malls(client)
    r = await client.post("/api/v1/inventory/transfer", headers=shop["h"], json={
        "from_store_id": shop["ms1"],
        "to_store_id": "11111111-1111-4111-8111-111111111111",
        "lines": [{"variant_id": shop["v1"], "delta": "5.000"}]})
    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "STORE_NOT_FOUND"


async def test_an_empty_transfer_is_refused(client: AsyncClient) -> None:
    shop = await _two_malls(client)
    r = await client.post("/api/v1/inventory/transfer", headers=shop["h"], json={
        "from_store_id": shop["ms1"], "to_store_id": shop["ms2"], "lines": []})
    assert r.status_code == 422, r.text


async def test_a_partial_transfer_does_not_half_apply(client: AsyncClient) -> None:
    """One bad line must take the whole transfer down, not half of it.

    Sending five of one item and a negative of another cannot leave the first
    item moved and the second not — that is stock created out of nothing.
    """
    shop = await _two_malls(client)
    r = await client.post("/api/v1/inventory/transfer", headers=shop["h"], json={
        "from_store_id": shop["ms1"], "to_store_id": shop["ms2"],
        "lines": [
            {"variant_id": shop["v1"], "delta": "5.000"},
            {"variant_id": shop["v2"], "delta": "-1.000"},
        ]})
    assert r.status_code == 422, r.text

    assert await _stock(client, shop, shop["ms1"], shop["v1"]) == Decimal("20.000")
    assert await _stock(client, shop, shop["ms2"], shop["v1"]) == Decimal("0")


# ---------------------------------------------------------------------------
# Selling what was transferred
# ---------------------------------------------------------------------------


async def test_the_receiving_mall_can_sell_what_arrived(client: AsyncClient) -> None:
    """The whole point: MS1's saree, carried over, sold on an MS2 bill.

    The bill is MS2's — MS2's series, MS2's GSTIN — and the stock comes off
    MS2, because after the transfer that is where the saree is.
    """
    shop = await _two_malls(client)
    await client.post("/api/v1/inventory/transfer", headers=shop["h"], json={
        "from_store_id": shop["ms1"], "to_store_id": shop["ms2"],
        "lines": [{"variant_id": shop["v1"], "delta": "6.000"}]})

    await client.post("/api/v1/day-sessions/open", headers=shop["h"],
                      json={"store_id": shop["ms2"], "opening_cash": "0.00"})
    r = await client.post("/api/v1/sales", headers=shop["h"], json={
        "store_id": shop["ms2"],
        "lines": [{"variant_id": shop["v1"], "quantity": "2.000"}],
        "payments": [{"method": "cash", "amount": "1612.00"}]})
    assert r.status_code == 201, r.text
    assert r.json()["number"].startswith("INV-MS3-"), "billed under MS2's own series"

    assert await _stock(client, shop, shop["ms2"], shop["v1"]) == Decimal("4.000")
    assert await _stock(client, shop, shop["ms1"], shop["v1"]) == Decimal("14.000")


async def test_each_mall_numbers_its_own_bills(client: AsyncClient) -> None:
    """Two GSTINs means two invoice series. Sharing one is a filing problem."""
    shop = await _two_malls(client)
    for store in (shop["ms1"], shop["ms2"]):
        await client.post("/api/v1/day-sessions/open", headers=shop["h"],
                          json={"store_id": store, "opening_cash": "0.00"})

    numbers = {}
    for key, store in (("ms1", shop["ms1"]), ("ms2", shop["ms2"])):
        r = await client.post("/api/v1/sales", headers=shop["h"], json={
            "store_id": store,
            "lines": [{"variant_id": shop["v2"], "quantity": "1.000"}],
            "payments": [{"method": "cash", "amount": "806.00"}]})
        assert r.status_code == 201, r.text
        numbers[key] = r.json()["number"]

    assert "MS1" in numbers["ms1"] and "MS3" in numbers["ms2"]
    assert numbers["ms1"] != numbers["ms2"]
    # Both are the first bill of their own series, not 1 and 2 of a shared one.
    assert numbers["ms1"].endswith("0001") and numbers["ms2"].endswith("0001")


# ---------------------------------------------------------------------------
# Staying in your own branch
# ---------------------------------------------------------------------------


async def _cashier_at(client: AsyncClient, shop: dict, store_id: str, email: str) -> dict:
    """A user pinned to one branch, which is how both malls will be staffed."""
    from app.core.security import hash_password
    from app.db.models.user import User, UserRole
    from app.db.session import session_scope
    import uuid as _uuid

    async with session_scope() as db:
        db.add(User(
            email=email,
            full_name="Counter Staff",
            hashed_password=hash_password("counter-password-1"),
            role=UserRole.MANAGER,
            is_active=True,
            store_id=_uuid.UUID(store_id),
        ))
    r = await client.post("/api/v1/auth/login",
                          json={"email": email, "password": "counter-password-1"})
    assert r.status_code == 200, r.text
    return auth(r.json()["tokens"]["access_token"])


async def test_a_branch_cashier_cannot_bill_under_the_other_gstin(
    client: AsyncClient,
) -> None:
    """The reason this guard exists.

    The store picker lists every branch. Without the check, an MS1 cashier is
    one wrong click from issuing an invoice carrying MS2's GSTIN — the wrong
    tax identity on a customer's bill, and nothing downstream would notice.
    """
    shop = await _two_malls(client)
    ms1_staff = await _cashier_at(client, shop, shop["ms1"], "ms1@example.com")

    await client.post("/api/v1/day-sessions/open", headers=shop["h"],
                      json={"store_id": shop["ms2"], "opening_cash": "0.00"})

    r = await client.post("/api/v1/sales", headers=ms1_staff, json={
        "store_id": shop["ms2"],
        "lines": [{"variant_id": shop["v1"], "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "806.00"}]})
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "WRONG_STORE"


async def test_a_branch_cashier_can_bill_their_own_branch(client: AsyncClient) -> None:
    shop = await _two_malls(client)
    ms1_staff = await _cashier_at(client, shop, shop["ms1"], "ms1b@example.com")

    await client.post("/api/v1/day-sessions/open", headers=ms1_staff,
                      json={"store_id": shop["ms1"], "opening_cash": "0.00"})
    r = await client.post("/api/v1/sales", headers=ms1_staff, json={
        "store_id": shop["ms1"],
        "lines": [{"variant_id": shop["v1"], "quantity": "1.000"}],
        "payments": [{"method": "cash", "amount": "806.00"}]})
    assert r.status_code == 201, r.text


async def test_a_branch_cashier_cannot_pull_stock_out_of_the_other_mall(
    client: AsyncClient,
) -> None:
    """Sending your own stock is ordinary. Reaching into the other mall and
    taking its stock is not — the staff there would never know."""
    shop = await _two_malls(client)
    ms1_staff = await _cashier_at(client, shop, shop["ms1"], "ms1c@example.com")

    r = await client.post("/api/v1/inventory/transfer", headers=ms1_staff, json={
        "from_store_id": shop["ms2"], "to_store_id": shop["ms1"],
        "lines": [{"variant_id": shop["v1"], "delta": "5.000"}]})
    assert r.status_code == 403, r.text

    # Sending FROM their own branch is fine.
    r = await client.post("/api/v1/inventory/transfer", headers=ms1_staff, json={
        "from_store_id": shop["ms1"], "to_store_id": shop["ms2"],
        "lines": [{"variant_id": shop["v1"], "delta": "5.000"}]})
    assert r.status_code == 201, r.text


async def test_an_owner_is_not_pinned_to_a_branch(client: AsyncClient) -> None:
    """store_id NULL means "works everywhere" — owners and roving managers.

    Keyed on the assignment rather than the role: a role says how much someone
    may do, this says where, and they are different questions.
    """
    shop = await _two_malls(client)
    for store in (shop["ms1"], shop["ms2"]):
        r = await client.post("/api/v1/day-sessions/open", headers=shop["h"],
                              json={"store_id": store, "opening_cash": "0.00"})
        assert r.status_code in (200, 201), r.text
