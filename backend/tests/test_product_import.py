"""Bulk catalog import.

An import is the most destructive thing a shop can do to its own catalog, so
most of these tests are about what it REFUSES to do: no partial writes, no
silent price changes, no ambiguous barcodes, no zero-price products that would
give stock away at the till.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from httpx import AsyncClient

from tests._helpers import auth, login


async def _setup(client: AsyncClient) -> dict:
    token = await login(client)
    h = auth(token)
    r = await client.post(
        "/api/v1/units",
        headers=h,
        json={"name": "Piece", "symbol": "pc", "is_fractional": False, "is_active": True},
    )
    assert r.status_code == 201, r.text
    return {"headers": h, "unit_id": r.json()["id"]}


HEADER = "name,sku,barcode,mrp,selling_price,tax_rate,hsn_code\n"


async def _import(client: AsyncClient, shop: dict, csv_text: str, **kwargs) -> dict:
    body = {"csv_text": csv_text, "default_unit": "pc", **kwargs}
    r = await client.post("/api/v1/products/import", headers=shop["headers"], json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ----------------------------------------------------------------- happy path


async def test_dry_run_reports_without_writing(client: AsyncClient) -> None:
    shop = await _setup(client)
    csv_text = HEADER + (
        "SHORT KURTI 660,160055.003,8901234567890,343.00,240.00,5,6211\n"
        "LONG KURTI 880,160055.004,8901234567891,550.00,385.00,5,6211\n"
    )

    result = await _import(client, shop, csv_text)

    assert result["dry_run"] is True
    assert result["committed"] is False
    assert result["total_rows"] == 2
    assert result["variants_to_create"] == 2
    assert result["products_to_create"] == 2
    assert result["errors"] == []

    # Nothing was written.
    listing = await client.get("/api/v1/products", headers=shop["headers"])
    assert listing.json()["total"] == 0


async def test_commit_creates_the_catalog(client: AsyncClient) -> None:
    shop = await _setup(client)
    csv_text = HEADER + "SHORT KURTI 660,160055.003,8901234567890,343.00,240.00,5,6211\n"

    result = await _import(client, shop, csv_text, dry_run=False)
    assert result["committed"] is True

    listing = await client.get("/api/v1/products", headers=shop["headers"])
    assert listing.json()["total"] == 1

    product_id = listing.json()["items"][0]["id"]
    product = (await client.get(f"/api/v1/products/{product_id}", headers=shop["headers"])).json()

    assert product["name"] == "SHORT KURTI 660"
    assert Decimal(product["tax_rate"]) == Decimal("5.00")
    assert product["hsn_code"] == "6211"

    variant = product["variants"][0]
    assert variant["sku"] == "160055.003"
    assert variant["barcode"] == "8901234567890"
    assert Decimal(variant["mrp"]) == Decimal("343.00")
    assert Decimal(variant["selling_price"]) == Decimal("240.00")


async def test_rows_sharing_a_name_become_one_product_with_variants(
    client: AsyncClient,
) -> None:
    shop = await _setup(client)
    csv_text = (
        "name,sku,variant_name,mrp,selling_price,tax_rate\n"
        "COTTON KURTI,CK-S,Small,500,350,5\n"
        "COTTON KURTI,CK-M,Medium,500,350,5\n"
        "COTTON KURTI,CK-L,Large,500,350,5\n"
    )

    result = await _import(client, shop, csv_text, dry_run=False)
    assert result["products_to_create"] == 1
    assert result["variants_to_create"] == 3

    listing = await client.get("/api/v1/products", headers=shop["headers"])
    assert listing.json()["total"] == 1
    product_id = listing.json()["items"][0]["id"]
    product = (await client.get(f"/api/v1/products/{product_id}", headers=shop["headers"])).json()
    assert len(product["variants"]) == 3
    assert {v["name"] for v in product["variants"]} == {"Small", "Medium", "Large"}


# ------------------------------------------------------- real-world messiness


async def test_accepts_the_decorations_real_exports_contain(
    client: AsyncClient,
) -> None:
    # Rupee signs, thousands separators and stray spaces. Asking a shopkeeper
    # to clean a 5,000-row file by hand is not a workable answer.
    shop = await _setup(client)
    csv_text = HEADER + 'SILK SAREE,SS-1,,"₹12,500.00","Rs. 9,999.00",5,5007\n'

    result = await _import(client, shop, csv_text, dry_run=False)
    assert result["errors"] == []

    listing = await client.get("/api/v1/products", headers=shop["headers"])
    product_id = listing.json()["items"][0]["id"]
    variant = (
        await client.get(f"/api/v1/products/{product_id}", headers=shop["headers"])
    ).json()["variants"][0]

    assert Decimal(variant["mrp"]) == Decimal("12500.00")
    assert Decimal(variant["selling_price"]) == Decimal("9999.00")


async def test_accepts_alternative_column_names(client: AsyncClient) -> None:
    # "code" and "rate" are what a Richie/Marg export actually calls them.
    shop = await _setup(client)
    csv_text = "Item Name,Code,Rate,GST\nTOWEL,TW-1,150,5\n"

    result = await _import(client, shop, csv_text, dry_run=False)
    assert result["errors"] == []
    assert result["variants_to_create"] == 1


async def test_survives_a_utf8_bom_from_excel(client: AsyncClient) -> None:
    # Left in place the BOM becomes part of the first header, so `name` fails
    # to match and every row errors for no visible reason.
    shop = await _setup(client)
    csv_text = "﻿" + HEADER + "TOWEL,TW-1,,150,120,5,6302\n"

    result = await _import(client, shop, csv_text)
    assert result["errors"] == []
    assert result["total_rows"] == 1


async def test_ignores_trailing_blank_lines(client: AsyncClient) -> None:
    shop = await _setup(client)
    csv_text = HEADER + "TOWEL,TW-1,,150,120,5,6302\n\n,,,,,,\n\n"

    result = await _import(client, shop, csv_text)
    assert result["total_rows"] == 1
    assert result["errors"] == []


# ------------------------------------------------------------- what it refuses


async def test_rejects_a_file_missing_required_columns(client: AsyncClient) -> None:
    shop = await _setup(client)
    result = await _import(client, shop, "name,price\nTOWEL,120\n")

    assert result["total_rows"] == 0
    assert len(result["errors"]) == 1
    assert "sku" in result["errors"][0]["message"].lower()


async def test_rejects_a_zero_price_product(client: AsyncClient) -> None:
    # A zero-price product scanned at a till gives stock away for free.
    shop = await _setup(client)
    result = await _import(client, shop, HEADER + "FREEBIE,FB-1,,100,0,5,6302\n")

    assert result["variants_to_create"] == 0
    assert any("greater than zero" in e["message"] for e in result["errors"])


async def test_reports_an_unparseable_price_with_its_row_number(
    client: AsyncClient,
) -> None:
    shop = await _setup(client)
    csv_text = HEADER + (
        "GOOD,G-1,,100,80,5,6302\n"
        "BAD,B-1,,100,abc,5,6302\n"
    )
    result = await _import(client, shop, csv_text)

    assert len(result["errors"]) == 1
    # Row 3: header is 1, the good row is 2. This must match what Excel shows.
    assert result["errors"][0]["row"] == 3
    assert result["errors"][0]["sku"] == "B-1"


async def test_rejects_duplicate_skus_within_the_file(client: AsyncClient) -> None:
    shop = await _setup(client)
    csv_text = HEADER + (
        "ONE,DUP-1,,100,80,5,6302\n"
        "TWO,DUP-1,,200,150,5,6302\n"
    )
    result = await _import(client, shop, csv_text)
    assert any("duplicate sku" in e["message"].lower() for e in result["errors"])


async def test_rejects_duplicate_barcodes_within_the_file(
    client: AsyncClient,
) -> None:
    # Two products on one barcode makes a scan ambiguous — the till would ring
    # up whichever row the database happened to return first.
    shop = await _setup(client)
    csv_text = HEADER + (
        "ONE,A-1,8901111111111,100,80,5,6302\n"
        "TWO,A-2,8901111111111,200,150,5,6302\n"
    )
    result = await _import(client, shop, csv_text)
    assert any("duplicate barcode" in e["message"].lower() for e in result["errors"])


async def test_rejects_a_barcode_already_used_by_another_sku(
    client: AsyncClient,
) -> None:
    shop = await _setup(client)
    await _import(client, shop, HEADER + "FIRST,F-1,8901111111111,100,80,5,6302\n", dry_run=False)

    result = await _import(client, shop, HEADER + "SECOND,S-1,8901111111111,200,150,5,6302\n")
    assert any("already used by sku" in e["message"].lower() for e in result["errors"])


async def test_rejects_an_unknown_unit(client: AsyncClient) -> None:
    shop = await _setup(client)
    r = await client.post(
        "/api/v1/products/import",
        headers=shop["headers"],
        json={"csv_text": HEADER + "TOWEL,TW-1,,150,120,5,6302\n", "default_unit": "furlong"},
    )
    assert r.status_code == 200
    assert any("does not exist" in e["message"] for e in r.json()["errors"])


async def test_writes_nothing_when_any_row_has_an_error(
    client: AsyncClient,
) -> None:
    # Atomicity. A half-imported catalog is worse than none: nobody can tell
    # which half is missing.
    shop = await _setup(client)
    csv_text = HEADER + (
        "GOOD ONE,G-1,,100,80,5,6302\n"
        "GOOD TWO,G-2,,200,150,5,6302\n"
        "BAD,B-1,,100,0,5,6302\n"
    )

    result = await _import(client, shop, csv_text, dry_run=False)

    assert result["committed"] is False
    assert result["errors"]
    listing = await client.get("/api/v1/products", headers=shop["headers"])
    assert listing.json()["total"] == 0


# ------------------------------------------------------------- re-importing


async def test_existing_skus_are_skipped_not_overwritten(
    client: AsyncClient,
) -> None:
    # Re-running yesterday's file must not silently change prices a shop is
    # already selling at.
    shop = await _setup(client)
    await _import(client, shop, HEADER + "TOWEL,TW-1,,150,120,5,6302\n", dry_run=False)

    result = await _import(client, shop, HEADER + "TOWEL,TW-1,,150,999,5,6302\n", dry_run=False)

    assert result["skipped_existing"] == 1
    assert result["variants_to_create"] == 0
    assert any("already exists" in w["message"].lower() for w in result["warnings"])

    listing = await client.get("/api/v1/products", headers=shop["headers"])
    product_id = listing.json()["items"][0]["id"]
    variant = (
        await client.get(f"/api/v1/products/{product_id}", headers=shop["headers"])
    ).json()["variants"][0]
    assert Decimal(variant["selling_price"]) == Decimal("120.00")


async def test_update_existing_changes_prices_when_asked(
    client: AsyncClient,
) -> None:
    shop = await _setup(client)
    await _import(client, shop, HEADER + "TOWEL,TW-1,,150,120,5,6302\n", dry_run=False)

    result = await _import(
        client, shop, HEADER + "TOWEL,TW-1,,180,145,5,6302\n",
        dry_run=False, update_existing=True,
    )
    assert result["variants_to_update"] == 1

    listing = await client.get("/api/v1/products", headers=shop["headers"])
    product_id = listing.json()["items"][0]["id"]
    variant = (
        await client.get(f"/api/v1/products/{product_id}", headers=shop["headers"])
    ).json()["variants"][0]
    assert Decimal(variant["selling_price"]) == Decimal("145.00")
    assert Decimal(variant["mrp"]) == Decimal("180.00")


async def test_importing_the_same_file_twice_creates_nothing_extra(
    client: AsyncClient,
) -> None:
    shop = await _setup(client)
    csv_text = HEADER + (
        "ONE,A-1,,100,80,5,6302\n"
        "TWO,A-2,,200,150,5,6302\n"
    )
    await _import(client, shop, csv_text, dry_run=False)
    await _import(client, shop, csv_text, dry_run=False)

    listing = await client.get("/api/v1/products", headers=shop["headers"])
    assert listing.json()["total"] == 2


# ------------------------------------------------------------------ warnings


async def test_missing_mrp_mirrors_the_selling_price(client: AsyncClient) -> None:
    # A zero MRP would make every receipt claim a 100% discount.
    shop = await _setup(client)
    await _import(client, shop, "name,sku,selling_price\nTOWEL,TW-1,120\n", dry_run=False)

    listing = await client.get("/api/v1/products", headers=shop["headers"])
    product_id = listing.json()["items"][0]["id"]
    variant = (
        await client.get(f"/api/v1/products/{product_id}", headers=shop["headers"])
    ).json()["variants"][0]
    assert Decimal(variant["mrp"]) == Decimal("120.00")


async def test_warns_when_no_tax_rate_was_supplied(client: AsyncClient) -> None:
    shop = await _setup(client)
    result = await _import(client, shop, "name,sku,selling_price\nTOWEL,TW-1,120\n")
    assert any("0% gst" in w["message"].lower() for w in result["warnings"])


# --------------------------------------------------------------- permissions


async def test_a_cashier_cannot_import_a_catalog(client: AsyncClient) -> None:
    from app.db.models.user import UserRole

    await _setup(client)
    token = await login(client, email="cashier@example.com")
    # Downgrade to cashier: importing rewrites what they sell from.
    from app.db.session import session_scope
    from sqlalchemy import select
    from app.db.models.user import User

    async with session_scope() as db:
        user = await db.scalar(select(User).where(User.email == "cashier@example.com"))
        user.role = UserRole.CASHIER

    r = await client.post(
        "/api/v1/products/import",
        headers=auth(token),
        json={"csv_text": HEADER + "X,X-1,,10,10,5,1\n", "default_unit": "pc"},
    )
    assert r.status_code == 403
