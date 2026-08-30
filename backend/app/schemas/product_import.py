"""Bulk catalog import — request and report shapes.

A shop arrives with thousands of SKUs in a spreadsheet exported from whatever
they used before. Until now the only way in was one product at a time through
the API, which made onboarding a new shop impossible in practice.

The report is deliberately detailed. An import that says "failed" tells an
operator nothing; one that says "row 47: selling price must be greater than
zero" tells them exactly what to fix.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ImportIssue(BaseModel):
    """One problem, tied to the spreadsheet row it came from."""

    # 1-based and counts the header, so it matches what the operator sees in
    # Excel. Off-by-one here would send someone to the wrong line.
    row: int
    sku: str | None = None
    message: str


class ProductImportRequest(BaseModel):
    csv_text: str = Field(
        min_length=1,
        description="Raw CSV content. UTF-8, with or without a BOM.",
    )
    dry_run: bool = Field(
        default=True,
        description=(
            "Validate and report without writing anything. Defaults to TRUE so a "
            "mistaken call cannot rewrite a shop's catalog."
        ),
    )
    update_existing: bool = Field(
        default=False,
        description=(
            "When a SKU already exists: false skips it and reports it, true "
            "updates its prices. Defaults to false so an import cannot silently "
            "change prices a shop is already selling at."
        ),
    )
    default_unit: str | None = Field(
        default=None,
        max_length=64,
        description=(
            "Unit symbol or name used for rows with no `unit` column, e.g. 'pc'. "
            "The unit must already exist."
        ),
    )


class ProductImportResult(BaseModel):
    dry_run: bool
    committed: bool

    total_rows: int
    products_to_create: int
    variants_to_create: int
    variants_to_update: int
    skipped_existing: int

    errors: list[ImportIssue] = Field(default_factory=list)
    warnings: list[ImportIssue] = Field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors
