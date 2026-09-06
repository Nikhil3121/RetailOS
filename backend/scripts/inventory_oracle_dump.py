"""Inventory every table in a Richie Retail dump, and export the ones with rows.

Only the FIRST occurrence of each table is used. The dump carries three
schemas — RICHIERETAIL (live), RICHIERETAIL_PK (a near-empty second copy) and
ORDCON — and RICHIERETAIL is the one with the data. Taking a later occurrence
would quietly export the empty copy instead.
"""

from __future__ import annotations

import csv
import io
import os
import re
import sys

from extract_oracle_dump import parse_rows, table_columns


def run(dmp: str, out_dir: str) -> None:
    data = open(dmp, "rb").read()
    os.makedirs(out_dir, exist_ok=True)

    seen: set[str] = set()
    report: list[tuple[str, int, int]] = []

    for m in re.finditer(rb'CREATE TABLE "([A-Z0-9_#$]+)"', data):
        name = m.group(1).decode()
        if name in seen:
            continue
        seen.add(name)

        ddl_end = data.find(b"\n", m.start())
        cols = table_columns(data[m.start():ddl_end].decode("latin-1", "replace"))
        if not cols:
            continue

        ins = data.find(b'INSERT INTO "%s"' % name.encode(), ddl_end)
        if ins == -1 or ins > ddl_end + 4000:
            report.append((name, -1, len(cols)))
            continue
        after = data.find(b"\n", ins) + 1

        declared = int.from_bytes(data[after:after + 2], "little")
        if declared != len(cols):
            report.append((name, -1, len(cols)))
            continue

        pos = after + 2
        for _ in range(declared):
            ctype = int.from_bytes(data[pos:pos + 2], "little")
            pos += 8 if ctype == 1 else 4

        got = parse_rows(data, pos + 4, [k for _, k in cols])
        if got is None:
            report.append((name, -1, len(cols)))
            continue

        rows = got[0]
        report.append((name, len(rows), len(cols)))

        if rows:
            with io.open(os.path.join(out_dir, f"{name}.csv"), "w",
                         newline="", encoding="utf-8") as fh:
                w = csv.writer(fh, quoting=csv.QUOTE_ALL)
                w.writerow([c for c, _ in cols])
                w.writerows(rows)

    populated = sorted([r for r in report if r[1] > 0], key=lambda r: -r[1])
    empty = [r for r in report if r[1] == 0]
    failed = [r for r in report if r[1] < 0]

    print(f"tables seen      : {len(report)}")
    print(f"  with rows      : {len(populated)}")
    print(f"  empty          : {len(empty)}")
    print(f"  unparsed       : {len(failed)}")
    print(f"total rows       : {sum(r[1] for r in populated):,}\n")
    print(f"{'TABLE':<26}{'ROWS':>10}{'COLS':>7}")
    for name, rows, ncols in populated:
        print(f"{name:<26}{rows:>10,}{ncols:>7}")
    if failed:
        print("\nunparsed:", ", ".join(n for n, _, _ in failed))


if __name__ == "__main__":
    run(sys.argv[1], sys.argv[2])
