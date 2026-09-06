"""Money off the whole bill, and rounding to the rupee.

RetailOS could only discount a LINE. That one gap blocked three separate
things: a plain "₹200 off" negotiated at the counter, coupons (fully built,
with a validate endpoint, and zero references in the billing screen because
there was nowhere to put the money), and loyalty redemption reducing the bill
it was redeemed against.

THE DISCOUNT IS NOT SPREAD ACROSS THE LINES, and that is the property most
worth pinning. Allocating it would change each line's taxable value and
therefore its GST — a tax decision, not something a discount box should make.
The per-line tax stands exactly as it was computed.
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login


async def _shop(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h, json={"code": "BD", "name": "Disc Store"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Saree", "unit_id": unit_id, "tax_rate": "5.00",
        "variants": [{"name": "Default", "sku": "BD-1", "cost_price": "400.00",
                      "mrp": "1000.00", "selling_price": "1000.00",
                      "reorder_point": "1.000", "reorder_quantity": "5.000"}]})
    variant_id = r.json()["variants"][0]["id"]

    await client.post("/api/v1/day-sessions/open", headers=h,
                      json={"store_id": store_id, "opening_cash": "0.00"})
    await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": store_id, "reason": "OPENING BALANCE",
        "lines": [{"variant_id": variant_id, "delta": "100.000"}]})

    return {"h": h, "token": token, "store_id": store_id, "variant_id": variant_id}


async def _sell(client: AsyncClient, shop: dict, **extra) -> dict:
    body = {
        "store_id": shop["store_id"],
        "lines": [{"variant_id": shop["variant_id"], "quantity": "1.000"}],
        "payments": [],
        **extra,
    }
    r = await client.post("/api/v1/sales", headers=shop["h"], json=body)
    return r


# ---------------------------------------------------------------------------
# The discount
# ---------------------------------------------------------------------------


async def test_a_bill_discount_reduces_the_total(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await _sell(client, shop, bill_discount="200.00",
                    payments=[{"method": "cash", "amount": "800.00"}])
    assert r.status_code == 201, r.text
    sale = r.json()
    assert Decimal(sale["bill_discount"]) == Decimal("200.00")
    assert Decimal(sale["grand_total"]) == Decimal("800.00")
    assert Decimal(sale["balance_due"]) == Decimal("0.00")


async def test_the_line_tax_is_untouched_by_a_bill_discount(
    client: AsyncClient,
) -> None:
    """The property this whole design turns on.

    Spreading the discount would move each line's taxable value and change its
    GST. The line keeps the tax it was computed with; only the bill total moves.
    """
    shop = await _shop(client)
    plain = (await _sell(client, shop,
                         payments=[{"method": "cash", "amount": "1000.00"}])).json()
    discounted = (await _sell(client, shop, bill_discount="200.00",
                              payments=[{"method": "cash", "amount": "800.00"}])).json()

    assert Decimal(plain["lines"][0]["tax_amount"]) == Decimal(
        discounted["lines"][0]["tax_amount"]
    )
    assert Decimal(plain["tax_total"]) == Decimal(discounted["tax_total"])


async def test_a_reason_can_be_recorded(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await _sell(client, shop, bill_discount="50.00",
                    bill_discount_reason="Regular customer",
                    payments=[{"method": "cash", "amount": "950.00"}])
    assert r.json()["bill_discount_reason"] == "Regular customer"


async def test_a_discount_larger_than_the_bill_is_refused(
    client: AsyncClient,
) -> None:
    """A negative sale reads downstream as a return."""
    shop = await _shop(client)
    r = await _sell(client, shop, bill_discount="5000.00")
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "BILL_DISCOUNT_EXCEEDS_TOTAL"


async def test_a_negative_discount_is_refused(client: AsyncClient) -> None:
    """It would be a surcharge wearing a discount's name."""
    shop = await _shop(client)
    r = await _sell(client, shop, bill_discount="-100.00")
    assert r.status_code == 422, r.text


async def test_a_discount_can_take_the_bill_to_zero(client: AsyncClient) -> None:
    """A giveaway is legitimate; a negative bill is not."""
    shop = await _shop(client)
    r = await _sell(client, shop, bill_discount="1000.00", payments=[])
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["grand_total"]) == Decimal("0.00")


# ---------------------------------------------------------------------------
# Round off
# ---------------------------------------------------------------------------


async def test_rounding_takes_the_bill_to_the_rupee(client: AsyncClient) -> None:
    """A drawer cannot make change for 40 paise."""
    shop = await _shop(client)
    r = await _sell(client, shop, bill_discount="0.40", round_off_enabled=True,
                    payments=[{"method": "cash", "amount": "1000.00"}])
    assert r.status_code == 201, r.text
    sale = r.json()
    # 1000.00 - 0.40 = 999.60, rounds up to 1000.00 with +0.40 recorded.
    assert Decimal(sale["round_off"]) == Decimal("0.40")
    assert Decimal(sale["grand_total"]) == Decimal("1000.00")


async def test_rounding_can_go_down_as_well_as_up(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await _sell(client, shop, bill_discount="0.60", round_off_enabled=True,
                    payments=[{"method": "cash", "amount": "999.00"}])
    sale = r.json()
    # 999.40 rounds down to 999.00, so the adjustment is negative.
    assert Decimal(sale["round_off"]) == Decimal("-0.40")
    assert Decimal(sale["grand_total"]) == Decimal("999.00")


async def test_the_bill_still_adds_up_with_both_applied(
    client: AsyncClient,
) -> None:
    """subtotal + tax - discount + round_off must equal the total on paper."""
    shop = await _shop(client)
    r = await _sell(client, shop, bill_discount="150.55", round_off_enabled=True,
                    payments=[{"method": "cash", "amount": "849.00"}])
    s = r.json()
    computed = (
        Decimal(s["subtotal"])
        + Decimal(s["tax_total"])
        - Decimal(s["bill_discount"])
        + Decimal(s["round_off"])
    )
    assert computed == Decimal(s["grand_total"])


async def test_rounding_is_off_unless_asked_for(client: AsyncClient) -> None:
    """No existing caller may change behaviour by upgrading."""
    shop = await _shop(client)
    r = await _sell(client, shop, bill_discount="0.40",
                    payments=[{"method": "cash", "amount": "999.60"}])
    assert Decimal(r.json()["round_off"]) == Decimal("0.00")
    assert Decimal(r.json()["grand_total"]) == Decimal("999.60")


# ---------------------------------------------------------------------------
# Nothing else moved
# ---------------------------------------------------------------------------


async def test_a_bill_with_no_discount_is_exactly_as_before(
    client: AsyncClient,
) -> None:
    shop = await _shop(client)
    r = await _sell(client, shop, payments=[{"method": "cash", "amount": "1000.00"}])
    assert r.status_code == 201, r.text
    sale = r.json()
    assert Decimal(sale["bill_discount"]) == Decimal("0.00")
    assert Decimal(sale["round_off"]) == Decimal("0.00")
    assert Decimal(sale["grand_total"]) == Decimal("1000.00")


async def test_a_discounted_bill_can_still_be_left_on_credit(
    client: AsyncClient,
) -> None:
    shop = await _shop(client)
    r = await client.post("/api/v1/customers", headers=shop["h"],
                          json={"name": "Ramesh"})
    customer_id = r.json()["id"]

    r = await _sell(client, shop, bill_discount="100.00", customer_id=customer_id,
                    payments=[{"method": "cash", "amount": "400.00"}])
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["grand_total"]) == Decimal("900.00")
    assert Decimal(r.json()["balance_due"]) == Decimal("500.00")


async def test_stock_still_moves_by_the_quantity_not_the_money(
    client: AsyncClient,
) -> None:
    """A discount is a money concept. It must not touch inventory."""
    shop = await _shop(client)
    await _sell(client, shop, bill_discount="500.00",
                payments=[{"method": "cash", "amount": "500.00"}])

    r = await client.get(f"/api/v1/inventory/levels?store_id={shop['store_id']}",
                         headers=shop["h"])
    row = next(x for x in r.json()["items"] if x["variant_id"] == shop["variant_id"])
    assert Decimal(row["quantity"]) == Decimal("99.000")


# ---------------------------------------------------------------------------
# Coupons — built, and until now unreachable
# ---------------------------------------------------------------------------


async def _coupon(client: AsyncClient, shop: dict, **over) -> dict:
    body = {"code": "DIWALI200", "name": "Diwali 200 off",
            "discount_type": "flat", "discount_value": "200.00",
            "min_bill_amount": "500.00", **over}
    r = await client.post("/api/v1/coupons", headers=shop["h"], json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def test_a_coupon_can_finally_be_applied_to_a_bill(
    client: AsyncClient,
) -> None:
    """Coupons had full CRUD, a validate endpoint, and no way to reach a bill.

    There was nowhere to put the money until the bill-level discount existed.
    """
    shop = await _shop(client)
    coupon = await _coupon(client, shop)

    r = await _sell(client, shop, bill_discount="200.00", coupon_id=coupon["id"],
                    payments=[{"method": "cash", "amount": "800.00"}])
    assert r.status_code == 201, r.text
    sale = r.json()
    assert sale["coupon_code"] == "DIWALI200"
    assert Decimal(sale["grand_total"]) == Decimal("800.00")


async def test_the_coupon_discount_is_recomputed_not_trusted(
    client: AsyncClient,
) -> None:
    """Naming a coupon must not let a modified client invent a discount."""
    shop = await _shop(client)
    coupon = await _coupon(client, shop)

    r = await _sell(client, shop, bill_discount="900.00", coupon_id=coupon["id"],
                    payments=[{"method": "cash", "amount": "100.00"}])
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "COUPON_DISCOUNT_MISMATCH"


async def test_a_coupon_below_its_minimum_bill_is_refused(
    client: AsyncClient,
) -> None:
    shop = await _shop(client)
    coupon = await _coupon(client, shop, min_bill_amount="5000.00")

    r = await _sell(client, shop, bill_discount="200.00", coupon_id=coupon["id"],
                    payments=[{"method": "cash", "amount": "800.00"}])
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "COUPON_INVALID"


async def test_applying_a_coupon_counts_against_its_usage_cap(
    client: AsyncClient,
) -> None:
    shop = await _shop(client)
    coupon = await _coupon(client, shop, max_uses_total=1)

    r = await _sell(client, shop, bill_discount="200.00", coupon_id=coupon["id"],
                    payments=[{"method": "cash", "amount": "800.00"}])
    assert r.status_code == 201, r.text

    r = await _sell(client, shop, bill_discount="200.00", coupon_id=coupon["id"],
                    payments=[{"method": "cash", "amount": "800.00"}])
    assert r.status_code == 422, "the cap was reached"


async def test_the_coupon_code_survives_the_coupon_being_deleted(
    client: AsyncClient,
) -> None:
    """Snapshotted, like the reward label and the MRP before it."""
    shop = await _shop(client)
    coupon = await _coupon(client, shop)
    r = await _sell(client, shop, bill_discount="200.00", coupon_id=coupon["id"],
                    payments=[{"method": "cash", "amount": "800.00"}])
    sale_id = r.json()["id"]

    from tests._helpers import elevate

    # A coupon that has been used on a real bill cannot be deleted at all —
    # its redemption rows carry money that came off an invoice. Refused
    # cleanly with 409, not as an unhandled database error.
    r = await client.delete(f"/api/v1/coupons/{coupon['id']}",
                            headers=await elevate(client, shop["token"]))
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "COUPON_IN_USE"

    r = await client.get(f"/api/v1/sales/{sale_id}", headers=shop["h"])
    assert r.json()["coupon_code"] == "DIWALI200"


async def test_an_unused_coupon_can_be_deleted(client: AsyncClient) -> None:
    from tests._helpers import elevate

    shop = await _shop(client)
    coupon = await _coupon(client, shop)
    r = await client.delete(f"/api/v1/coupons/{coupon['id']}",
                            headers=await elevate(client, shop["token"]))
    assert r.status_code == 204, r.text
