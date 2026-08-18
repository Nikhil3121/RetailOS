"""One-shot idempotent seeders run at app startup.

Keeps the app usable out-of-the-box for common workflows that would otherwise
need a manual admin step (e.g. picking an expense category before any exist).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.expense import ExpenseCategory


_DEFAULT_EXPENSE_CATEGORIES: list[tuple[str, str, str]] = [
    ("GENERAL", "General", "Miscellaneous operating costs."),
    ("RENT", "Rent", "Store or warehouse rent."),
    ("UTILITIES", "Utilities", "Electricity, water, internet."),
    ("SALARIES", "Salaries", "Payroll and staff wages."),
    ("MARKETING", "Marketing", "Ads, promotions, POSM."),
    ("SUPPLIES", "Supplies", "Packaging, cleaning, stationery."),
]


async def seed_default_expense_categories(db: AsyncSession) -> None:
    """Ensure a small set of expense categories exists so the Expenses screen
    works without the user having to create one first. Idempotent — skips any
    category whose code already exists."""
    existing = {
        c or ""
        for c in (
            await db.scalars(select(ExpenseCategory.code))
        ).all()
    }
    added = False
    for code, name, description in _DEFAULT_EXPENSE_CATEGORIES:
        if code in existing:
            continue
        db.add(
            ExpenseCategory(
                code=code, name=name, description=description, is_active=True
            )
        )
        added = True
    if added:
        await db.commit()
