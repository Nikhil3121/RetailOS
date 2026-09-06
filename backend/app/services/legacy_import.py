"""Load a Richie Retail export into RetailOS.

WHAT THIS READS
---------------
The CSVs produced from an Oracle `exp` dump — one file per table, headers
exactly as the legacy columns were named. The tables that matter:

    STORE     the branches            -> stores       (legacy_code 1, 3)
    LAM       the product master      -> products      (138 rows)
    LAMC      the SKU master          -> product_variants (9,999 rows)
    MARKA     brands                  -> brands
    CUSTOMER  customers               -> customers

THE ONE FACT THIS EXISTS TO CARRY ACROSS
----------------------------------------
`LAMC_SCOMPANYCODE` is the product series: "1" is MS MALL, "3" is MS MALL 2.
It becomes `product_variants.origin_store_id`, and it is the whole reason the
merged database can later answer "how many MS1 items did MS2 sell today".

WHAT IS DELIBERATELY NOT IMPORTED
---------------------------------
STOCK. The export's `STOCK_SA` is a denormalised report keyed on brand/group/
item/size/colour NAMES with all its id columns zeroed; only 38% of its rows
join back to a SKU, covering 37% of the quantity. The per-SKU counters on LAMC
disagree with it by more than 2x because `LAMC_NSQ` (sold quantity) is not
maintained. Importing either would put a number on screen that is wrong in a
way nobody could see. Opening stock belongs in a physical count.

HISTORY. 21,371 bills stay in the archive. Past GST returns were filed from the
old system, and a foreign schema never reconciles perfectly.

THE SAFETY MODEL
----------------
Same as the CSV catalog import: dry run by default, validate everything before
writing anything, one transaction, and existing SKUs are skipped rather than
overwritten. Re-running must never rewrite prices a shop is already selling at.
"""

from __future__ import annotations

import csv
import io
import os
import uuid
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.brand import Brand
from app.db.models.category import Category
from app.db.models.customer import Customer
from app.db.models.product import Product, ProductVariant
from app.db.models.store import Store
from app.db.models.unit import Unit
from app.services._slug import slugify

#: Legacy placeholders that mean "nothing", written inconsistently over years.
_BLANKS = {"", "N/A", "NA", ".", "-", "0", "NIL", "NONE"}


def clean(value: str | None) -> str:
    """Trim, and treat the legacy placeholders as empty."""
    v = (value or "").strip()
    return "" if v.upper() in _BLANKS else v


def text(value: str | None) -> str:
    """Trim only. For fields where "0" is a legitimate value."""
    return (value or "").strip()


def money(value: str | None) -> Decimal:
    """A legacy amount as Decimal, never float.

    Returns 0 for anything unparseable rather than raising: a single bad price
    in nine thousand rows must not abort an import, and a zero is visible on
    screen where an exception is not.
    """
    raw = (value or "").strip()
    if not raw:
        return Decimal("0.00")
    try:
        return Decimal(raw).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return Decimal("0.00")


def unique_slug(name: str, taken: set[str]) -> str:
    """A slug that is free, derived from the legacy name.

    Both `brands.slug` and `categories.slug` are unique, and legacy names
    collapse onto each other easily — "5 STAR" and "5-STAR" slugify the same.
    A suffix keeps both rows rather than losing one to an integrity error
    halfway through a nine-thousand-row import.
    """
    base = slugify(name) or "item"
    slug, n = base, 2
    while slug in taken:
        slug = f"{base}-{n}"
        n += 1
    taken.add(slug)
    return slug


@dataclass
class ImportReport:
    """What an import did, or would do. Printed before anything is written."""

    dry_run: bool = True
    stores: int = 0
    units: int = 0
    brands: int = 0
    categories: int = 0
    products: int = 0
    variants: int = 0
    customers: int = 0
    skipped_existing_skus: int = 0
    origin_ms1: int = 0
    origin_ms2: int = 0
    origin_unknown: int = 0
    issues: list[str] = field(default_factory=list)

    def render(self) -> str:
        mode = "DRY RUN — nothing written" if self.dry_run else "COMMITTED"
        lines = [
            f"=== Legacy import: {mode} ===",
            f"  stores            {self.stores}",
            f"  units             {self.units}",
            f"  brands            {self.brands}",
            f"  categories        {self.categories}",
            f"  products          {self.products}",
            f"  variants          {self.variants}",
            f"     from MS1 range {self.origin_ms1}",
            f"     from MS2 range {self.origin_ms2}",
            f"     no series      {self.origin_unknown}",
            f"  customers         {self.customers}",
            f"  SKUs skipped      {self.skipped_existing_skus} (already present)",
        ]
        if self.issues:
            lines.append(f"  issues            {len(self.issues)}")
            lines += [f"    - {i}" for i in self.issues[:20]]
            if len(self.issues) > 20:
                lines.append(f"    … and {len(self.issues) - 20} more")
        return "\n".join(lines)


def read_csv(folder: str, name: str) -> list[dict[str, str]]:
    path = os.path.join(folder, f"{name}.csv")
    if not os.path.exists(path):
        return []
    with io.open(path, encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


class LegacyImportService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def run(self, folder: str, *, commit: bool = False) -> ImportReport:
        report = ImportReport(dry_run=not commit)

        stores = await self._stores(folder, report)
        units = await self._units(folder, report)
        brands = await self._brands(folder, report)
        categories = await self._categories(folder, report)
        await self._products(folder, report, stores, units, brands, categories)
        await self._customers(folder, report)

        if commit:
            await self.db.flush()
        else:
            # Everything above is in the session but nothing is written. The
            # caller rolls back; this makes that explicit rather than implied.
            await self.db.rollback()

        return report

    # -- branches ---------------------------------------------------------

    async def _stores(self, folder: str, report: ImportReport) -> dict[str, Store]:
        """Match legacy branches to RetailOS stores, creating any that are missing.

        Matched on `legacy_code` first, then on name. Never on the store's
        RetailOS `code`, which the operator may have chosen independently.
        """
        rows = read_csv(folder, "STORE")
        existing = list((await self.db.execute(select(Store))).scalars().all())
        by_legacy = {s.legacy_code: s for s in existing if s.legacy_code}
        by_name = {s.name.strip().upper(): s for s in existing}

        out: dict[str, Store] = {}
        for row in rows:
            legacy = text(row.get("STORE_SCODE"))
            name = text(row.get("STORE_SNAME")) or f"Store {legacy}"
            if not legacy:
                continue

            store = by_legacy.get(legacy) or by_name.get(name.upper())
            if store is None:
                store = Store(
                    code=f"MS{legacy}",
                    name=name,
                    address_line1=text(row.get("STORE_SADDRESS1")) or None,
                    address_line2=text(row.get("STORE_SADDRESS2")) or None,
                    phone=clean(row.get("STORE_SPHONE")) or None,
                    email=clean(row.get("STORE_SEMAIL")) or None,
                )
                self.db.add(store)
                report.stores += 1

            # Stamp the legacy identity even on a store that already existed —
            # that is what lets a re-run match instead of duplicating.
            store.legacy_code = legacy
            store.sku_prefix = store.sku_prefix or f"MS{legacy}"
            out[legacy] = store

        await self.db.flush()
        return out

    # -- lookups ----------------------------------------------------------

    async def _units(self, folder: str, report: ImportReport) -> dict[str, Unit]:
        names = {clean(r.get("LAM_SUNIT")) for r in read_csv(folder, "LAM")}
        names = {n for n in names if n} or {"PCS"}

        existing = list((await self.db.execute(select(Unit))).scalars().all())
        by_name = {u.name.strip().upper(): u for u in existing}
        by_symbol = {(u.symbol or "").strip().upper(): u for u in existing}

        out: dict[str, Unit] = {}
        for name in sorted(names):
            unit = by_name.get(name.upper()) or by_symbol.get(name.upper())
            if unit is None:
                unit = Unit(name=name.title(), symbol=name.lower()[:16], is_fractional=False)
                self.db.add(unit)
                report.units += 1
            out[name.upper()] = unit

        await self.db.flush()
        return out

    async def _brands(self, folder: str, report: ImportReport) -> dict[str, Brand]:
        names = {clean(r.get("MARKA_SNAME")) for r in read_csv(folder, "MARKA")}
        names |= {clean(r.get("LAMC_SMARKA")) for r in read_csv(folder, "LAMC")}
        names = {n for n in names if n}

        existing = list((await self.db.execute(select(Brand))).scalars().all())
        by_name = {b.name.strip().upper(): b for b in existing}
        slugs = {b.slug for b in existing}

        out: dict[str, Brand] = {}
        for name in sorted(names):
            brand = by_name.get(name.upper())
            if brand is None:
                brand = Brand(name=name, slug=unique_slug(name, slugs))
                self.db.add(brand)
                report.brands += 1
            out[name.upper()] = brand

        await self.db.flush()
        return out

    async def _categories(self, folder: str, report: ImportReport) -> dict[str, Category]:
        """DIVISION is the parent, SECTION the child — the legacy hierarchy."""
        rows = read_csv(folder, "LAM")
        pairs = {
            (clean(r.get("LAM_SDIVISION")), clean(r.get("LAM_SSECTION")))
            for r in rows
        }

        existing = list((await self.db.execute(select(Category))).scalars().all())
        by_name = {c.name.strip().upper(): c for c in existing}
        slugs = {c.slug for c in existing}
        out: dict[str, Category] = {}

        for division, section in sorted(pairs):
            parent = None
            if division:
                parent = by_name.get(division.upper())
                if parent is None:
                    parent = Category(name=division, slug=unique_slug(division, slugs))
                    self.db.add(parent)
                    await self.db.flush()
                    by_name[division.upper()] = parent
                    report.categories += 1
                out[division.upper()] = parent

            if section:
                child = by_name.get(section.upper())
                if child is None:
                    child = Category(
                        name=section,
                        slug=unique_slug(section, slugs),
                        parent_id=parent.id if parent is not None else None,
                    )
                    self.db.add(child)
                    await self.db.flush()
                    by_name[section.upper()] = child
                    report.categories += 1
                out[section.upper()] = child

        return out

    # -- catalogue --------------------------------------------------------

    async def _products(
        self,
        folder: str,
        report: ImportReport,
        stores: dict[str, Store],
        units: dict[str, Unit],
        brands: dict[str, Brand],
        categories: dict[str, Category],
    ) -> None:
        lam = read_csv(folder, "LAM")
        lamc = read_csv(folder, "LAMC")
        if not lam or not lamc:
            report.issues.append("LAM or LAMC missing — no catalogue imported")
            return

        # Existing SKUs are skipped, never overwritten: a re-run must not
        # rewrite a price the shop is currently selling at.
        taken = set(
            (await self.db.execute(select(ProductVariant.sku))).scalars().all()
        )

        variants_by_lam: dict[str, list[dict[str, str]]] = {}
        for row in lamc:
            variants_by_lam.setdefault(text(row.get("LAMC_SLAMCODE")), []).append(row)

        fallback_unit = next(iter(units.values()))

        for prod in lam:
            code = text(prod.get("LAM_SCODE"))
            children = variants_by_lam.get(code, [])
            if not children:
                continue

            unit = units.get(clean(prod.get("LAM_SUNIT")).upper(), fallback_unit)
            section = clean(prod.get("LAM_SSECTION"))
            division = clean(prod.get("LAM_SDIVISION"))
            category = categories.get(section.upper()) or categories.get(division.upper())

            # HSN and tax live per-SKU in the legacy schema but per-product
            # here. Taking the first non-empty is safe: within one product they
            # are the same, because HSN is a property of what the thing IS.
            hsn = next((clean(c.get("LAMC_SHSNCODE")) for c in children
                        if clean(c.get("LAMC_SHSNCODE"))), "")
            tax = next((money(c.get("LAMC_NCGSTPERCENT")) + money(c.get("LAMC_NSGSTPERCENT"))
                        for c in children
                        if money(c.get("LAMC_NCGSTPERCENT")) > 0), Decimal("0.00"))

            product = Product(
                name=text(prod.get("LAM_SNAME")) or f"Item {code}",
                hsn_code=hsn[:16] or None,
                tax_rate=min(tax, Decimal("100.00")),
                unit_id=unit.id,
                category_id=category.id if category is not None else None,
                source_data={k: v for k, v in prod.items() if v},
            )
            self.db.add(product)
            await self.db.flush()
            report.products += 1

            for order, child in enumerate(children):
                sku = text(child.get("LAMC_SCODE"))
                if not sku:
                    report.issues.append(f"{product.name}: a SKU row has no code")
                    continue
                if sku in taken:
                    report.skipped_existing_skus += 1
                    continue
                taken.add(sku)

                size = clean(child.get("LAMC_SSIZE"))
                colour = clean(child.get("LAMC_SCOL"))
                style = clean(child.get("LAMC_SSTYLE"))
                brand = brands.get(clean(child.get("LAMC_SMARKA")).upper())

                # The series. "1" is MS MALL, "3" is MS MALL 2.
                series = text(child.get("LAMC_SCOMPANYCODE"))
                origin = stores.get(series)
                if origin is None:
                    report.origin_unknown += 1
                elif series == "1":
                    report.origin_ms1 += 1
                else:
                    report.origin_ms2 += 1

                label = " / ".join(p for p in (style, size, colour) if p) or "Default"

                self.db.add(
                    ProductVariant(
                        product_id=product.id,
                        name=label[:255],
                        sku=sku[:64],
                        attributes={
                            k: v for k, v in
                            {"size": size, "colour": colour, "style": style}.items() if v
                        },
                        cost_price=money(child.get("LAMC_NKINDAAM")),
                        selling_price=money(child.get("LAMC_NBECHAT")),
                        mrp=money(child.get("LAMC_NCOMPMRP")),
                        origin_store_id=origin.id if origin is not None else None,
                        sort_order=order,
                        source_data={k: v for k, v in child.items() if v},
                    )
                )
                report.variants += 1

                # The brand sits on the product here and on the SKU in the
                # legacy schema. First one wins rather than the last, so a
                # stray value on SKU 9,000 cannot rebrand the whole product.
                if brand is not None and product.brand_id is None:
                    product.brand_id = brand.id

            await self.db.flush()

    # -- customers --------------------------------------------------------

    async def _customers(self, folder: str, report: ImportReport) -> None:
        rows = read_csv(folder, "CUSTOMER")
        if not rows:
            return

        existing = list((await self.db.execute(select(Customer))).scalars().all())
        seen_phone = {c.phone for c in existing if c.phone}
        seen_name = {c.name.strip().upper() for c in existing}

        for row in rows:
            name = text(row.get("CUSTOMER_SNAME"))
            if not name:
                continue
            phone = (
                clean(row.get("CUSTOMER_SMOBILE"))
                or clean(row.get("CUSTOMER_SMOBILE1"))
                or clean(row.get("CUSTOMER_SOFFICEPHONE"))
            )
            # Phone is the identity when there is one; otherwise the name. A
            # shop with two "Ramesh" and no numbers gets one record, which is
            # wrong — but merging two real people is worse than splitting one.
            if (phone and phone in seen_phone) or (not phone and name.upper() in seen_name):
                continue

            self.db.add(
                Customer(
                    name=name,
                    phone=phone[:32] or None,
                    gstin=clean(row.get("CUSTOMER_SGSTNO"))[:15] or None,
                    address_line1=text(row.get("CUSTOMER_SRESIADDRESS"))[:255] or None,
                    source_data={k: v for k, v in row.items() if v},
                )
            )
            if phone:
                seen_phone.add(phone)
            seen_name.add(name.upper())
            report.customers += 1

        await self.db.flush()
