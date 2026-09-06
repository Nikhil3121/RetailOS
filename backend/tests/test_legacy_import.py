"""Importing a Richie Retail export.

The one fact this whole feature exists to carry across is the product SERIES:
`LAMC_SCOMPANYCODE` is "1" for MS MALL and "3" for MS MALL 2. Lose it and the
merged database can never answer "how many MS1 items did MS2 sell today",
which is the question the owner actually asks.

The rest of these tests guard the things that would corrupt a real catalogue:
re-running overwriting live prices, a bad price aborting nine thousand rows,
and series being forced onto the product when the data says it belongs to the
SKU.
"""

from __future__ import annotations

import csv
import io
import os
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.db.models.product import Product, ProductVariant
from app.db.models.store import Store
from app.db.session import session_scope
from app.services.legacy_import import (
    LegacyImportService,
    clean,
    money,
    unique_slug,
)

# --- a miniature export -----------------------------------------------------

STORE_ROWS = [
    {"STORE_SCODE": "1", "STORE_SNAME": "MS MALL",
     "STORE_SADDRESS1": "THANA ROAD", "STORE_SPHONE": "7004633410"},
    {"STORE_SCODE": "3", "STORE_SNAME": "MS MALL 2",
     "STORE_SADDRESS1": "GT ROAD", "STORE_SPHONE": ""},
]

LAM_ROWS = [
    {"LAM_SCODE": "31", "LAM_SNAME": "COTTON SAREE", "LAM_SUNIT": "PCS",
     "LAM_SSECTION": "SAREE", "LAM_SDIVISION": "TEXTILE"},
    # The product that straddles both ranges — this is real, from the export.
    {"LAM_SCODE": "360", "LAM_SNAME": "COAT PANT", "LAM_SUNIT": "PCS",
     "LAM_SSECTION": "SUIT", "LAM_SDIVISION": "TEXTILE"},
]

LAMC_ROWS = [
    {"LAMC_SLAMCODE": "31", "LAMC_SCODE": "300100", "LAMC_SNAME": "COTTON SAREE",
     "LAMC_SSTYLE": "REDBLOOM", "LAMC_SSIZE": "PLOP", "LAMC_SCOL": "N/A",
     "LAMC_SMARKA": "RATAN", "LAMC_NKINDAAM": "620", "LAMC_NBECHAT": "806",
     "LAMC_NCOMPMRP": "1128", "LAMC_SHSNCODE": "620000",
     "LAMC_NCGSTPERCENT": "2.5", "LAMC_NSGSTPERCENT": "2.5",
     "LAMC_SCOMPANYCODE": "3"},
    {"LAMC_SLAMCODE": "360", "LAMC_SCODE": "306643", "LAMC_SNAME": "COAT PANT",
     "LAMC_SSTYLE": "", "LAMC_SSIZE": "40", "LAMC_SCOL": "BLACK",
     "LAMC_SMARKA": "RAYMOND", "LAMC_NKINDAAM": "2000", "LAMC_NBECHAT": "3200",
     "LAMC_NCOMPMRP": "4500", "LAMC_SHSNCODE": "621030",
     "LAMC_NCGSTPERCENT": "6", "LAMC_NSGSTPERCENT": "6",
     "LAMC_SCOMPANYCODE": "1"},
    {"LAMC_SLAMCODE": "360", "LAMC_SCODE": "306700", "LAMC_SNAME": "COAT PANT",
     "LAMC_SSTYLE": "", "LAMC_SSIZE": "42", "LAMC_SCOL": "NAVY",
     "LAMC_SMARKA": "RAYMOND", "LAMC_NKINDAAM": "2100", "LAMC_NBECHAT": "3400",
     "LAMC_NCOMPMRP": "4800", "LAMC_SHSNCODE": "621030",
     "LAMC_NCGSTPERCENT": "6", "LAMC_NSGSTPERCENT": "6",
     "LAMC_SCOMPANYCODE": "3"},
]

CUSTOMER_ROWS = [
    {"CUSTOMER_SNAME": "Ramesh Kumar", "CUSTOMER_SMOBILE": "9876500001",
     "CUSTOMER_SGSTNO": "", "CUSTOMER_SRESIADDRESS": "Madanpur"},
    {"CUSTOMER_SNAME": "Sita Devi", "CUSTOMER_SMOBILE": "9876500002",
     "CUSTOMER_SGSTNO": "", "CUSTOMER_SRESIADDRESS": ""},
]

MARKA_ROWS = [{"MARKA_SCODE": "1", "MARKA_SNAME": "RATAN"},
              {"MARKA_SCODE": "2", "MARKA_SNAME": "RAYMOND"}]


def write_export(folder: str, **overrides) -> str:
    tables = {
        "STORE": STORE_ROWS, "LAM": LAM_ROWS, "LAMC": LAMC_ROWS,
        "CUSTOMER": CUSTOMER_ROWS, "MARKA": MARKA_ROWS,
    }
    tables.update(overrides)
    for name, rows in tables.items():
        with io.open(os.path.join(folder, f"{name}.csv"), "w",
                     newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()), quoting=csv.QUOTE_ALL)
            w.writeheader()
            w.writerows(rows)
    return folder


@pytest.fixture
def export(tmp_path) -> str:
    return write_export(str(tmp_path))


# --- helpers ----------------------------------------------------------------


def test_clean_treats_legacy_placeholders_as_empty() -> None:
    """Years of data entry left several spellings of "nothing"."""
    for placeholder in ["", " ", "N/A", "n/a", "NA", ".", "-", "0", "NIL"]:
        assert clean(placeholder) == ""
    assert clean("  RATAN ") == "RATAN"


def test_money_never_uses_float() -> None:
    assert money("806") == Decimal("806.00")
    assert money("1128.50") == Decimal("1128.50")
    # A single unparseable price must not abort nine thousand rows.
    assert money("abc") == Decimal("0.00")
    assert money("") == Decimal("0.00")
    assert money(None) == Decimal("0.00")


def test_unique_slug_keeps_both_colliding_names() -> None:
    """"5 STAR" and "5-STAR" slugify the same; losing one is not acceptable."""
    taken: set[str] = set()
    assert unique_slug("5 STAR", taken) == "5-star"
    assert unique_slug("5-STAR", taken) == "5-star-2"


# --- the import ------------------------------------------------------------


async def test_series_becomes_the_origin_branch(export: str) -> None:
    """The fact the whole feature turns on."""
    async with session_scope() as db:
        report = await LegacyImportService(db).run(export, commit=True)

    assert report.origin_ms1 == 1
    assert report.origin_ms2 == 2
    assert report.origin_unknown == 0

    async with session_scope() as db:
        stores = {s.legacy_code: s for s in (await db.execute(select(Store))).scalars()}
        ms1, ms2 = stores["1"], stores["3"]

        by_origin = dict(
            (await db.execute(
                select(ProductVariant.origin_store_id, func.count(ProductVariant.id))
                .group_by(ProductVariant.origin_store_id)
            )).all()
        )
        assert by_origin[ms1.id] == 1
        assert by_origin[ms2.id] == 2


async def test_a_product_can_hold_skus_from_both_ranges(export: str) -> None:
    """"COAT PANT" really does span both series in the export.

    This is why origin lives on the variant. On the product it would force one
    wrong answer for every product that straddles the two ranges.
    """
    async with session_scope() as db:
        await LegacyImportService(db).run(export, commit=True)

    async with session_scope() as db:
        product = (await db.execute(
            select(Product).where(Product.name == "COAT PANT")
        )).scalar_one()
        origins = set((await db.execute(
            select(ProductVariant.origin_store_id)
            .where(ProductVariant.product_id == product.id)
        )).scalars())
        assert len(origins) == 2, "one product, two ranges"


async def test_prices_and_attributes_survive(export: str) -> None:
    async with session_scope() as db:
        await LegacyImportService(db).run(export, commit=True)

    async with session_scope() as db:
        v = (await db.execute(
            select(ProductVariant).where(ProductVariant.sku == "300100")
        )).scalar_one()
        assert v.cost_price == Decimal("620.00")
        assert v.selling_price == Decimal("806.00")
        assert v.mrp == Decimal("1128.00")
        assert v.attributes["size"] == "PLOP"
        assert v.attributes["style"] == "REDBLOOM"
        # Colour was "N/A" in the source — a placeholder, not a colour.
        assert "colour" not in v.attributes

        product = (await db.execute(
            select(Product).where(Product.id == v.product_id)
        )).scalar_one()
        assert product.hsn_code == "620000"
        assert product.tax_rate == Decimal("5.00"), "CGST 2.5 + SGST 2.5"


async def test_the_raw_legacy_row_is_kept(export: str) -> None:
    """Nothing is lost. 88 columns come in; the schema surfaces a dozen."""
    async with session_scope() as db:
        await LegacyImportService(db).run(export, commit=True)

    async with session_scope() as db:
        v = (await db.execute(
            select(ProductVariant).where(ProductVariant.sku == "300100")
        )).scalar_one()
        assert v.source_data["LAMC_SCOMPANYCODE"] == "3"
        assert v.source_data["LAMC_SSTYLE"] == "REDBLOOM"


async def test_a_dry_run_writes_nothing(export: str) -> None:
    """The default. An import is the most destructive thing a shop can do."""
    async with session_scope() as db:
        report = await LegacyImportService(db).run(export, commit=False)

    assert report.dry_run is True
    assert report.variants == 3, "it still reports what WOULD happen"

    async with session_scope() as db:
        assert (await db.execute(select(func.count(ProductVariant.id)))).scalar() == 0


async def test_re_running_does_not_rewrite_live_prices(export: str) -> None:
    """A second import must not overwrite a price the shop is selling at."""
    async with session_scope() as db:
        await LegacyImportService(db).run(export, commit=True)

    async with session_scope() as db:
        v = (await db.execute(
            select(ProductVariant).where(ProductVariant.sku == "300100")
        )).scalar_one()
        v.selling_price = Decimal("999.00")

    async with session_scope() as db:
        second = await LegacyImportService(db).run(export, commit=True)

    assert second.skipped_existing_skus == 3
    assert second.variants == 0

    async with session_scope() as db:
        v = (await db.execute(
            select(ProductVariant).where(ProductVariant.sku == "300100")
        )).scalar_one()
        assert v.selling_price == Decimal("999.00"), "the shop's own price stood"


async def test_re_running_does_not_duplicate_branches(export: str) -> None:
    async with session_scope() as db:
        await LegacyImportService(db).run(export, commit=True)
    async with session_scope() as db:
        await LegacyImportService(db).run(export, commit=True)

    async with session_scope() as db:
        assert (await db.execute(select(func.count(Store.id)))).scalar() == 2


async def test_customers_come_across(export: str) -> None:
    async with session_scope() as db:
        report = await LegacyImportService(db).run(export, commit=True)
    assert report.customers == 2


async def test_a_bad_price_does_not_abort_the_import(tmp_path) -> None:
    """One corrupt cell in nine thousand rows must not lose the other 8,999."""
    rows = [dict(LAMC_ROWS[0]), dict(LAMC_ROWS[1]), dict(LAMC_ROWS[2])]
    rows[0]["LAMC_NBECHAT"] = "not a number"
    export = write_export(str(tmp_path), LAMC=rows)

    async with session_scope() as db:
        report = await LegacyImportService(db).run(export, commit=True)

    assert report.variants == 3
    async with session_scope() as db:
        v = (await db.execute(
            select(ProductVariant).where(ProductVariant.sku == "300100")
        )).scalar_one()
        assert v.selling_price == Decimal("0.00")


async def test_an_empty_folder_is_reported_not_crashed(tmp_path) -> None:
    async with session_scope() as db:
        report = await LegacyImportService(db).run(str(tmp_path), commit=False)
    assert report.variants == 0
    assert any("LAM" in i for i in report.issues)
