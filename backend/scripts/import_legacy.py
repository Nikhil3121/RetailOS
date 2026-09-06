"""Load a Richie Retail CSV export into RetailOS.

    python scripts/import_legacy.py <csv-folder>            # dry run, writes nothing
    python scripts/import_legacy.py <csv-folder> --commit   # actually write

Dry run is the default on purpose. An import is the most destructive thing that
can be done to a shop's catalogue, and the report tells you what WOULD happen
before anything does.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal  # noqa: E402
from app.services.legacy_import import LegacyImportService  # noqa: E402


async def main() -> int:
    ap = argparse.ArgumentParser(description="Import a Richie Retail CSV export.")
    ap.add_argument("folder", help="Folder of per-table CSVs (LAM.csv, LAMC.csv, …)")
    ap.add_argument(
        "--commit",
        action="store_true",
        help="Write the changes. Without this nothing is saved.",
    )
    args = ap.parse_args()

    if not Path(args.folder).is_dir():
        print(f"No such folder: {args.folder}")
        return 2

    async with SessionLocal() as db:
        report = await LegacyImportService(db).run(args.folder, commit=args.commit)
        if args.commit:
            await db.commit()

    print(report.render())
    if not args.commit:
        print("\nNothing was written. Re-run with --commit to apply.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
