"""Bulk catalog import from CSV.

── WHY THIS EXISTS ─────────────────────────────────────────────────────────
Products could only be created one at a time. A textile shop has thousands of
SKUs, so onboarding one was impossible in practice — there was nothing to scan.

── THE SAFETY MODEL ────────────────────────────────────────────────────────
An import is the single most destructive thing a shop can do to its own
catalog, so the design assumes the file is wrong until proved otherwise:

  1. DRY RUN BY DEFAULT. Nothing is written unless the caller explicitly asks.
     The report says exactly what would happen first.
  2. VALIDATE EVERYTHING, THEN WRITE. Every row is checked before any row is
     written, so the operator gets the full list of problems in one pass
     instead of fixing them one failed import at a time.
  3. ONE TRANSACTION. Either the whole file lands or none of it does. A
     half-imported catalog is worse than no catalog: nobody can tell which
     half is missing.
  4. EXISTING SKUs ARE SKIPPED. Re-importing a file must not silently rewrite
     prices a shop is already selling at. Updating is opt-in.

── NO DUPLICATED BUSINESS LOGIC ────────────────────────────────────────────
Rows are turned into the SAME `ProductCreate` / `VariantCreate` models the API
already uses, and written through the SAME `ProductService`. This module parses
and plans; it does not re-implement what a product is.
"""

from __future__ import annotations

import csv
import io
import re
import uuid
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.product import Product, ProductVariant
from app.db.models.unit import Unit
from app.schemas.product import ProductCreate, VariantCreate, VariantUpdate
from app.schemas.product_import import (
    ImportIssue,
    ProductImportRequest,
    ProductImportResult,
)
from app.services.product import ProductService

# Accepted spellings for each column. Shops export from different systems and
# nobody is going to rename headers by hand, so the common variants are mapped
# rather than rejected.
COLUMN_ALIASES: dict[str, str] = {
    "name": "name",
    "product": "name",
    "product_name": "name",
    "item": "name",
    "item_name": "name",
    "description": "description",
    "sku": "sku",
    "code": "sku",
    "item_code": "sku",
    "product_code": "sku",
    "barcode": "barcode",
    "ean": "barcode",
    "upc": "barcode",
    "variant": "variant_name",
    "variant_name": "variant_name",
    "size": "variant_name",
    "mrp": "mrp",
    "max_retail_price": "mrp",
    "price": "selling_price",
    "selling_price": "selling_price",
    "sale_price": "selling_price",
    "rate": "selling_price",
    "cost": "cost_price",
    "cost_price": "cost_price",
    "purchase_price": "cost_price",
    "tax": "tax_rate",
    "tax_rate": "tax_rate",
    "gst": "tax_rate",
    "gst_rate": "tax_rate",
    "hsn": "hsn_code",
    "hsn_code": "hsn_code",
    "unit": "unit",
    "uom": "unit",
}

REQUIRED_COLUMNS = {"name", "sku", "selling_price"}


@dataclass
class ParsedRow:
    """One spreadsheet row, after parsing but before planning."""

    row_number: int
    name: str
    sku: str
    selling_price: Decimal
    mrp: Decimal
    cost_price: Decimal
    tax_rate: Decimal
    barcode: str | None = None
    variant_name: str | None = None
    hsn_code: str | None = None
    unit: str | None = None
    description: str | None = None


@dataclass
class ImportPlan:
    rows: list[ParsedRow] = field(default_factory=list)
    errors: list[ImportIssue] = field(default_factory=list)
    warnings: list[ImportIssue] = field(default_factory=list)
    # SKUs that already exist, mapped to the variant they belong to.
    existing: dict[str, uuid.UUID] = field(default_factory=dict)


def _normalise_header(value: str) -> str:
    """`  Selling Price ` -> `selling_price`, then through the alias table."""
    cleaned = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    return COLUMN_ALIASES.get(cleaned, cleaned)


def parse_decimal(raw: str | None, *, field_name: str) -> Decimal:
    """Parse money from a spreadsheet cell.

    Real exports contain `Rs.1,234.56`, `₹343`, `1 234.56` and empty strings.
    Rejecting those would mean asking a shopkeeper to clean a 5,000-row file by
    hand, so the common decorations are stripped. Anything still unparseable is
    reported rather than guessed at — a wrong price is worse than a failed row.
    """
    if raw is None:
        return Decimal("0")
    text = raw.strip()
    if not text:
        return Decimal("0")

    cleaned = re.sub(r"[₹$€£]|rs\.?|inr", "", text, flags=re.IGNORECASE)
    cleaned = cleaned.replace(",", "").replace(" ", "").strip()
    if not cleaned:
        return Decimal("0")

    try:
        value = Decimal(cleaned)
    except InvalidOperation as exc:
        raise ValueError(f"{field_name} is not a number: {text!r}") from exc

    if value < 0:
        raise ValueError(f"{field_name} cannot be negative: {text!r}")
    # Money is stored with two decimal places; more precision than that in a
    # source file is a data-entry artefact, not information.
    return value.quantize(Decimal("0.01"))


def parse_csv(text: str) -> tuple[list[ParsedRow], list[ImportIssue]]:
    """Turn CSV text into rows, collecting every problem rather than stopping."""
    errors: list[ImportIssue] = []

    # Excel on Windows writes a UTF-8 BOM. Left in place it becomes part of the
    # first header, so `name` silently fails to match and every row errors.
    cleaned = text.lstrip("﻿")
    reader = csv.DictReader(io.StringIO(cleaned))

    if reader.fieldnames is None:
        return [], [ImportIssue(row=0, message="The file is empty.")]

    headers = {_normalise_header(h or "") for h in reader.fieldnames}
    missing = REQUIRED_COLUMNS - headers
    if missing:
        return [], [
            ImportIssue(
                row=1,
                message=(
                    f"Missing required column(s): {', '.join(sorted(missing))}. "
                    f"Found: {', '.join(sorted(h for h in headers if h))}."
                ),
            )
        ]

    rows: list[ParsedRow] = []
    for index, raw_row in enumerate(reader):
        # +2: the header is row 1 and spreadsheets are 1-based, so this is the
        # line number the operator sees in Excel.
        row_number = index + 2
        row = {_normalise_header(k or ""): (v or "") for k, v in raw_row.items()}

        # Blank lines at the end of a file are normal; they are not errors.
        if not any(value.strip() for value in row.values()):
            continue

        name = row.get("name", "").strip()
        sku = row.get("sku", "").strip()

        if not name:
            errors.append(ImportIssue(row=row_number, sku=sku or None, message="Name is required."))
            continue
        if not sku:
            errors.append(ImportIssue(row=row_number, message=f"SKU is required (product {name!r})."))
            continue

        try:
            selling_price = parse_decimal(row.get("selling_price"), field_name="Selling price")
            mrp = parse_decimal(row.get("mrp"), field_name="MRP")
            cost_price = parse_decimal(row.get("cost_price"), field_name="Cost price")
            tax_rate = parse_decimal(row.get("tax_rate"), field_name="Tax rate")
        except ValueError as exc:
            errors.append(ImportIssue(row=row_number, sku=sku, message=str(exc)))
            continue

        # A zero-price product scanned at a till gives stock away for free.
        # Rejecting it is safer than importing a hazard.
        if selling_price <= 0:
            errors.append(
                ImportIssue(row=row_number, sku=sku, message="Selling price must be greater than zero.")
            )
            continue

        if tax_rate > 100:
            errors.append(
                ImportIssue(row=row_number, sku=sku, message=f"Tax rate {tax_rate} is above 100%.")
            )
            continue

        rows.append(
            ParsedRow(
                row_number=row_number,
                name=name,
                sku=sku,
                selling_price=selling_price,
                # No MRP supplied means "no saving to advertise", so it mirrors
                # the selling price rather than defaulting to zero — a zero MRP
                # would make every receipt claim a 100% discount.
                mrp=mrp if mrp > 0 else selling_price,
                cost_price=cost_price,
                tax_rate=tax_rate,
                barcode=(row.get("barcode") or "").strip() or None,
                variant_name=(row.get("variant_name") or "").strip() or None,
                hsn_code=(row.get("hsn_code") or "").strip() or None,
                unit=(row.get("unit") or "").strip() or None,
                description=(row.get("description") or "").strip() or None,
            )
        )

    return rows, errors


def find_duplicates(rows: list[ParsedRow]) -> list[ImportIssue]:
    """Duplicate SKUs and barcodes WITHIN the file.

    A duplicate barcode is not cosmetic: two products sharing one barcode means
    a scan is ambiguous, and the till would silently ring up whichever the
    database returned first.
    """
    issues: list[ImportIssue] = []
    seen_sku: dict[str, int] = {}
    seen_barcode: dict[str, int] = {}

    for row in rows:
        key = row.sku.lower()
        if key in seen_sku:
            issues.append(
                ImportIssue(
                    row=row.row_number,
                    sku=row.sku,
                    message=f"Duplicate SKU — already used on row {seen_sku[key]}.",
                )
            )
        else:
            seen_sku[key] = row.row_number

        if row.barcode:
            bkey = row.barcode.lower()
            if bkey in seen_barcode:
                issues.append(
                    ImportIssue(
                        row=row.row_number,
                        sku=row.sku,
                        message=(
                            f"Duplicate barcode {row.barcode} — already used on row "
                            f"{seen_barcode[bkey]}. Scanning it would be ambiguous."
                        ),
                    )
                )
            else:
                seen_barcode[bkey] = row.row_number

    return issues


class ProductImportService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def run(self, request: ProductImportRequest) -> ProductImportResult:
        rows, errors = parse_csv(request.csv_text)
        warnings: list[ImportIssue] = []

        if errors and not rows:
            # The file itself is unusable (no header, missing columns).
            return ProductImportResult(
                dry_run=request.dry_run, committed=False, total_rows=0,
                products_to_create=0, variants_to_create=0, variants_to_update=0,
                skipped_existing=0, errors=errors, warnings=warnings,
            )

        errors.extend(find_duplicates(rows))

        # ---- resolve units -------------------------------------------------
        units = {u.symbol.lower(): u for u in (await self.db.scalars(select(Unit))).all()}
        units.update({u.name.lower(): u for u in units.copy().values()})
        default_unit = (
            units.get(request.default_unit.strip().lower()) if request.default_unit else None
        )
        if request.default_unit and default_unit is None:
            errors.append(
                ImportIssue(
                    row=0,
                    message=(
                        f"Unit {request.default_unit!r} does not exist. "
                        f"Available: {', '.join(sorted({u.symbol for u in units.values()})) or 'none'}."
                    ),
                )
            )

        # ---- existing SKUs and barcodes -----------------------------------
        skus = [r.sku for r in rows]
        existing_variants = (
            await self.db.scalars(select(ProductVariant).where(ProductVariant.sku.in_(skus)))
        ).all()
        existing_by_sku = {v.sku.lower(): v for v in existing_variants}

        barcodes = [r.barcode for r in rows if r.barcode]
        if barcodes:
            clashing = (
                await self.db.scalars(
                    select(ProductVariant).where(ProductVariant.barcode.in_(barcodes))
                )
            ).all()
            clash_by_barcode = {
                v.barcode.lower(): v for v in clashing if v.barcode is not None
            }
            for row in rows:
                if not row.barcode:
                    continue
                existing = clash_by_barcode.get(row.barcode.lower())
                # A barcode already on a DIFFERENT SKU makes scanning ambiguous.
                if existing is not None and existing.sku.lower() != row.sku.lower():
                    errors.append(
                        ImportIssue(
                            row=row.row_number,
                            sku=row.sku,
                            message=(
                                f"Barcode {row.barcode} is already used by SKU {existing.sku}."
                            ),
                        )
                    )

        # ---- group rows into products -------------------------------------
        groups: dict[str, list[ParsedRow]] = {}
        for row in rows:
            groups.setdefault(row.name.strip().lower(), []).append(row)

        to_create: list[ParsedRow] = []
        to_update: list[ParsedRow] = []
        skipped = 0

        for row in rows:
            if row.sku.lower() in existing_by_sku:
                if request.update_existing:
                    to_update.append(row)
                else:
                    skipped += 1
                    warnings.append(
                        ImportIssue(
                            row=row.row_number,
                            sku=row.sku,
                            message="SKU already exists — skipped. Use 'update existing' to change its prices.",
                        )
                    )
            else:
                to_create.append(row)
                if row.tax_rate == 0:
                    warnings.append(
                        ImportIssue(
                            row=row.row_number,
                            sku=row.sku,
                            message="No tax rate supplied — imported as 0% GST.",
                        )
                    )

        # A product is only created when it has at least one new variant.
        new_groups = {
            name: [r for r in members if r in to_create]
            for name, members in groups.items()
        }
        products_to_create = sum(1 for members in new_groups.values() if members)

        # Every new product needs a unit, and a product cannot be created
        # without one, so a missing unit is an error rather than a warning.
        for name, members in new_groups.items():
            if not members:
                continue
            for row in members:
                resolved = units.get(row.unit.lower()) if row.unit else default_unit
                if resolved is None:
                    errors.append(
                        ImportIssue(
                            row=row.row_number,
                            sku=row.sku,
                            message=(
                                "No unit for this row. Add a 'unit' column or set a default unit."
                            ),
                        )
                    )

        result = ProductImportResult(
            dry_run=request.dry_run,
            committed=False,
            total_rows=len(rows),
            products_to_create=products_to_create,
            variants_to_create=len(to_create),
            variants_to_update=len(to_update),
            skipped_existing=skipped,
            errors=errors,
            warnings=warnings,
        )

        # Nothing is written on a dry run, and nothing is written when the file
        # has errors — a partly-correct catalog is not worth the reconciliation.
        if request.dry_run or errors:
            return result

        await self._write(new_groups, to_update, existing_by_sku, units, default_unit)
        result.committed = True
        return result

    async def _write(
        self,
        new_groups: dict[str, list[ParsedRow]],
        to_update: list[ParsedRow],
        existing_by_sku: dict[str, ProductVariant],
        units: dict[str, Unit],
        default_unit: Unit | None,
    ) -> None:
        """Write through the EXISTING product service, in the caller's transaction.

        No commit here: the endpoint's session commits on success and rolls the
        whole file back on any failure, which is what makes the import atomic.
        """
        service = ProductService(self.db)

        for members in new_groups.values():
            if not members:
                continue
            first = members[0]
            unit = units.get(first.unit.lower()) if first.unit else default_unit
            assert unit is not None  # planning rejected rows without a unit

            await service.create(
                ProductCreate(
                    name=first.name,
                    description=first.description,
                    hsn_code=first.hsn_code,
                    tax_rate=first.tax_rate,
                    unit_id=unit.id,
                    variants=[
                        VariantCreate(
                            # A single-variant product reads better named after
                            # itself than as "Default".
                            name=row.variant_name or row.name,
                            sku=row.sku,
                            barcode=row.barcode,
                            cost_price=row.cost_price,
                            mrp=row.mrp,
                            selling_price=row.selling_price,
                            sort_order=index,
                        )
                        for index, row in enumerate(members)
                    ],
                )
            )

        for row in to_update:
            variant = existing_by_sku[row.sku.lower()]
            await service.update_variant(
                variant.id,
                VariantUpdate(
                    barcode=row.barcode,
                    cost_price=row.cost_price,
                    mrp=row.mrp,
                    selling_price=row.selling_price,
                ),
            )
