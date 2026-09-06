"""Payables — what the shop owes its suppliers.

RetailOS tracked customer dues in detail and knew nothing about the other side.
A shop that buys on credit from mills has to answer "what do we owe, to whom,
and how old is it" before it can pay anyone correctly.

The property these pin hardest is that THE BALANCE IS DERIVED. It is the sum of
the entries, never a cached column, so it cannot drift away from the documents
behind it — and a payables figure that has drifted gets paid twice or not at
all.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login


async def _shop(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h, json={"code": "PY", "name": "Pay Store"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/suppliers", headers=h, json={"code": "MILL", "name": "Ratan Mills"})
    supplier_id = r.json()["id"]
    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False})
    unit_id = r.json()["id"]
    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Saree", "unit_id": unit_id, "tax_rate": "0.00",
        "variants": [{"name": "Default", "sku": "PY-1", "cost_price": "400.00",
                      "mrp": "1000.00", "selling_price": "900.00",
                      "reorder_point": "1.000", "reorder_quantity": "5.000"}]})
    variant_id = r.json()["variants"][0]["id"]

    return {"h": h, "token": token, "store_id": store_id,
            "supplier_id": supplier_id, "variant_id": variant_id}


async def _receive_po(client: AsyncClient, shop: dict, qty: str, cost: str) -> dict:
    r = await client.post("/api/v1/purchase-orders", headers=shop["h"], json={
        "store_id": shop["store_id"], "supplier_id": shop["supplier_id"],
        "order_date": "2027-01-10",
        "lines": [{"variant_id": shop["variant_id"], "quantity": qty, "unit_cost": cost}]})
    assert r.status_code == 201, r.text
    po = r.json()
    assert (await client.post(f"/api/v1/purchase-orders/{po['id']}/confirm",
                              headers=shop["h"])).status_code == 200
    assert (await client.post(f"/api/v1/purchase-orders/{po['id']}/receive",
                              headers=shop["h"])).status_code == 200
    return po


async def _balance(client: AsyncClient, shop: dict) -> Decimal:
    r = await client.get("/api/v1/payables/outstanding", headers=shop["h"])
    assert r.status_code == 200, r.text
    for row in r.json():
        if row["supplier_id"] == shop["supplier_id"]:
            return Decimal(row["outstanding"])
    return Decimal("0")


# ---------------------------------------------------------------------------
# The debt
# ---------------------------------------------------------------------------


async def test_receiving_goods_creates_the_debt(client: AsyncClient) -> None:
    shop = await _shop(client)
    await _receive_po(client, shop, "10.000", "400.00")
    assert await _balance(client, shop) == Decimal("4000.00")


async def test_no_debt_until_the_goods_arrive(client: AsyncClient) -> None:
    """A purchase order is an intention. The money is owed on RECEIPT."""
    shop = await _shop(client)
    r = await client.post("/api/v1/purchase-orders", headers=shop["h"], json={
        "store_id": shop["store_id"], "supplier_id": shop["supplier_id"],
        "order_date": "2027-01-10",
        "lines": [{"variant_id": shop["variant_id"], "quantity": "10.000",
                   "unit_cost": "400.00"}]})
    po = r.json()
    await client.post(f"/api/v1/purchase-orders/{po['id']}/confirm", headers=shop["h"])

    assert await _balance(client, shop) == Decimal("0"), "confirmed, not received"


async def test_paying_reduces_what_is_owed(client: AsyncClient) -> None:
    shop = await _shop(client)
    await _receive_po(client, shop, "10.000", "400.00")

    r = await client.post(
        f"/api/v1/payables/suppliers/{shop['supplier_id']}/payments",
        headers=shop["h"],
        json={"amount": "1500.00", "entry_date": "2027-01-15", "reference": "NEFT-991"})
    assert r.status_code == 201, r.text

    assert await _balance(client, shop) == Decimal("2500.00")


async def test_paying_in_full_settles_the_supplier(client: AsyncClient) -> None:
    shop = await _shop(client)
    await _receive_po(client, shop, "10.000", "400.00")
    await client.post(
        f"/api/v1/payables/suppliers/{shop['supplier_id']}/payments",
        headers=shop["h"], json={"amount": "4000.00", "entry_date": "2027-01-15"})

    r = await client.get("/api/v1/payables/outstanding", headers=shop["h"])
    assert all(row["supplier_id"] != shop["supplier_id"] for row in r.json()), \
        "a settled supplier drops off the list by default"

    r = await client.get("/api/v1/payables/outstanding?include_settled=true",
                         headers=shop["h"])
    row = next(x for x in r.json() if x["supplier_id"] == shop["supplier_id"])
    assert Decimal(row["outstanding"]) == Decimal("0.00")
    assert Decimal(row["total_purchased"]) == Decimal("4000.00")
    assert Decimal(row["total_paid"]) == Decimal("4000.00")


async def test_an_opening_balance_can_be_carried_in(client: AsyncClient) -> None:
    """Go-live: without this every supplier starts at zero and the first
    payment against an old bill drives the balance negative."""
    shop = await _shop(client)
    r = await client.post(
        f"/api/v1/payables/suppliers/{shop['supplier_id']}/opening-balance",
        headers=shop["h"], json={"amount": "12500.00", "entry_date": "2027-01-01"})
    assert r.status_code == 201, r.text
    assert await _balance(client, shop) == Decimal("12500.00")


async def test_an_adjustment_needs_a_reason(client: AsyncClient) -> None:
    shop = await _shop(client)
    r = await client.post(
        f"/api/v1/payables/suppliers/{shop['supplier_id']}/adjustments",
        headers=shop["h"], json={"amount": "100.00", "entry_date": "2027-01-15",
                                 "description": ""})
    assert r.status_code == 422, r.text


async def test_an_adjustment_can_move_the_balance_either_way(
    client: AsyncClient,
) -> None:
    shop = await _shop(client)
    await _receive_po(client, shop, "10.000", "400.00")

    await client.post(
        f"/api/v1/payables/suppliers/{shop['supplier_id']}/adjustments",
        headers=shop["h"], json={"amount": "-250.00", "entry_date": "2027-01-16",
                                 "description": "Rate difference agreed on call"})
    assert await _balance(client, shop) == Decimal("3750.00")


async def test_the_ledger_shows_every_movement(client: AsyncClient) -> None:
    shop = await _shop(client)
    await _receive_po(client, shop, "10.000", "400.00")
    await client.post(
        f"/api/v1/payables/suppliers/{shop['supplier_id']}/payments",
        headers=shop["h"], json={"amount": "1000.00", "entry_date": "2027-01-15"})

    r = await client.get(f"/api/v1/payables/suppliers/{shop['supplier_id']}/ledger",
                         headers=shop["h"])
    assert r.status_code == 200, r.text
    kinds = {row["entry_type"] for row in r.json()}
    assert kinds == {"purchase", "payment"}

    # Credit is what the shop owes, debit what it has paid. Never both on one row.
    for row in r.json():
        assert not (Decimal(row["debit"]) > 0 and Decimal(row["credit"]) > 0)


async def test_the_balance_is_the_sum_of_the_entries(client: AsyncClient) -> None:
    """Derived, never cached — so it cannot drift from the documents."""
    shop = await _shop(client)
    await _receive_po(client, shop, "10.000", "400.00")
    await _receive_po(client, shop, "5.000", "400.00")
    await client.post(
        f"/api/v1/payables/suppliers/{shop['supplier_id']}/payments",
        headers=shop["h"], json={"amount": "2000.00", "entry_date": "2027-01-15"})

    r = await client.get(f"/api/v1/payables/suppliers/{shop['supplier_id']}/ledger",
                         headers=shop["h"])
    total = sum(Decimal(x["credit"]) - Decimal(x["debit"]) for x in r.json())
    assert total == await _balance(client, shop) == Decimal("4000.00")


# ---------------------------------------------------------------------------
# Landed cost
# ---------------------------------------------------------------------------


async def test_freight_is_added_to_what_is_owed(client: AsyncClient) -> None:
    """A bale at ₹4,000 with ₹200 freight really cost ₹4,200."""
    shop = await _shop(client)
    r = await client.post("/api/v1/purchase-orders", headers=shop["h"], json={
        "store_id": shop["store_id"], "supplier_id": shop["supplier_id"],
        "order_date": "2027-01-10",
        "lines": [{"variant_id": shop["variant_id"], "quantity": "10.000",
                   "unit_cost": "400.00"}]})
    po = r.json()

    r = await client.post(f"/api/v1/payables/purchase-orders/{po['id']}/charges",
                          headers=shop["h"],
                          json={"label": "Freight", "amount": "200.00"})
    assert r.status_code == 201, r.text

    await client.post(f"/api/v1/purchase-orders/{po['id']}/confirm", headers=shop["h"])
    await client.post(f"/api/v1/purchase-orders/{po['id']}/receive", headers=shop["h"])

    assert await _balance(client, shop) == Decimal("4200.00")


async def test_a_deduction_reduces_what_is_owed(client: AsyncClient) -> None:
    """The legacy "kalti" — a shortage allowance the mill knocks off."""
    shop = await _shop(client)
    r = await client.post("/api/v1/purchase-orders", headers=shop["h"], json={
        "store_id": shop["store_id"], "supplier_id": shop["supplier_id"],
        "order_date": "2027-01-10",
        "lines": [{"variant_id": shop["variant_id"], "quantity": "10.000",
                   "unit_cost": "400.00"}]})
    po = r.json()
    await client.post(f"/api/v1/payables/purchase-orders/{po['id']}/charges",
                      headers=shop["h"],
                      json={"label": "Damage allowance", "amount": "300.00",
                            "is_deduction": True})
    await client.post(f"/api/v1/purchase-orders/{po['id']}/confirm", headers=shop["h"])
    await client.post(f"/api/v1/purchase-orders/{po['id']}/receive", headers=shop["h"])

    assert await _balance(client, shop) == Decimal("3700.00")


async def test_a_charge_carries_its_own_tax_rate(client: AsyncClient) -> None:
    """Freight is taxed differently from the goods it carries."""
    shop = await _shop(client)
    r = await client.post("/api/v1/purchase-orders", headers=shop["h"], json={
        "store_id": shop["store_id"], "supplier_id": shop["supplier_id"],
        "order_date": "2027-01-10",
        "lines": [{"variant_id": shop["variant_id"], "quantity": "10.000",
                   "unit_cost": "400.00"}]})
    po = r.json()
    await client.post(f"/api/v1/payables/purchase-orders/{po['id']}/charges",
                      headers=shop["h"],
                      json={"label": "Freight", "amount": "200.00", "tax_rate": "5.00"})
    await client.post(f"/api/v1/purchase-orders/{po['id']}/confirm", headers=shop["h"])
    await client.post(f"/api/v1/purchase-orders/{po['id']}/receive", headers=shop["h"])

    # 200 + 5% = 210
    assert await _balance(client, shop) == Decimal("4210.00")


async def test_a_purchase_with_no_charges_behaves_exactly_as_before(
    client: AsyncClient,
) -> None:
    """Nothing about charges may change a shop that never enters one."""
    shop = await _shop(client)
    await _receive_po(client, shop, "10.000", "400.00")
    assert await _balance(client, shop) == Decimal("4000.00")


# ---------------------------------------------------------------------------
# Repricing history
# ---------------------------------------------------------------------------


async def test_a_price_change_is_recorded_with_both_values(
    client: AsyncClient,
) -> None:
    shop = await _shop(client)
    r = await client.patch(f"/api/v1/products/variants/{shop['variant_id']}",
                           headers=shop["h"],
                           json={"selling_price": "950.00", "mrp": "1100.00"})
    assert r.status_code == 200, r.text

    r = await client.get("/api/v1/payables/price-changes", headers=shop["h"])
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1
    row = r.json()[0]
    assert Decimal(row["old_selling_price"]) == Decimal("900.00")
    assert Decimal(row["new_selling_price"]) == Decimal("950.00")
    assert Decimal(row["old_mrp"]) == Decimal("1000.00")
    assert Decimal(row["new_mrp"]) == Decimal("1100.00")


async def test_editing_without_touching_a_price_records_nothing(
    client: AsyncClient,
) -> None:
    """Otherwise the price history fills with noise about renamed variants."""
    shop = await _shop(client)
    await client.patch(f"/api/v1/products/variants/{shop['variant_id']}",
                       headers=shop["h"], json={"name": "Renamed"})

    r = await client.get("/api/v1/payables/price-changes", headers=shop["h"])
    assert r.json() == []


async def test_setting_a_price_to_the_same_value_records_nothing(
    client: AsyncClient,
) -> None:
    shop = await _shop(client)
    await client.patch(f"/api/v1/products/variants/{shop['variant_id']}",
                       headers=shop["h"], json={"selling_price": "900.00"})

    r = await client.get("/api/v1/payables/price-changes", headers=shop["h"])
    assert r.json() == []


async def test_price_history_can_be_read_for_one_sku(client: AsyncClient) -> None:
    shop = await _shop(client)
    for price in ("910.00", "920.00", "930.00"):
        await client.patch(f"/api/v1/products/variants/{shop['variant_id']}",
                           headers=shop["h"], json={"selling_price": price})

    r = await client.get(
        f"/api/v1/payables/price-changes?variant_id={shop['variant_id']}",
        headers=shop["h"])
    assert len(r.json()) == 3
