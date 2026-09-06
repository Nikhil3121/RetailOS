"""Extract tables from an Oracle `exp` dump to CSV, without Oracle.

WHY NOT JUST USE ORACLE
-----------------------
Restoring this properly means an Oracle instance and `imp`. That is the right
answer for a full migration. For deciding WHAT to migrate we only need to read
the rows, and standing up Oracle to answer "how many customers are in here" is
a poor trade.

THE FORMAT
----------
A classic exp dump interleaves readable DDL with binary row data:

    CREATE TABLE "X" (...)          <- plain text, gives column names + types
    INSERT INTO "X" (...) VALUES (:1, :2, ...)
    <column descriptors>
    <rows>                          <- length-prefixed field values
    FF FF                           <- end of this table's rows

Each field is a 2-byte LITTLE-ENDIAN length followed by that many bytes.
FE FF (65534) means NULL. FF FF (65535) ends the table.

VARCHAR2 arrives as raw text. NUMBER arrives in Oracle's base-100 form. DATE
arrives as 7 bytes. All three are decoded below.

FINDING WHERE ROWS START
------------------------
The descriptor block between the INSERT and the first row varies by column
type, and guessing its length is fragile. So instead of computing it, we TRY
each plausible offset and keep the one that parses cleanly all the way to the
FF FF terminator with a whole number of complete rows. A wrong offset
desynchronises within a row or two and is rejected — which makes a silently
mis-parsed table very unlikely, and that matters here because the output is
going to be loaded into a real database.
"""

from __future__ import annotations

import csv
import io
import os
import re
import sys

NULL = 0xFFFE
END = 0xFFFF


# ---------------------------------------------------------------------------
# Oracle scalar decoding
# ---------------------------------------------------------------------------

def decode_number(b: bytes) -> str:
    """Oracle's base-100 NUMBER representation."""
    if not b:
        return ""
    first = b[0]
    positive = bool(first & 0x80)

    if positive:
        exponent = (first & 0x7F) - 65
        digits = [d - 1 for d in b[1:]]
    else:
        exponent = (~first & 0x7F) - 65
        digits = [101 - d for d in b[1:]]
        # A negative number is terminated by 102; it is not a digit.
        if digits and digits[-1] == 101 - 102:
            digits = digits[:-1]

    if not digits:
        return "0"

    # Assemble as a decimal string rather than a float — these are prices and
    # quantities, and a float would quietly round them on the way out.
    int_part, frac_part = "", ""
    for i, d in enumerate(digits):
        pair = f"{d:02d}"
        if i <= exponent:
            int_part += pair
        else:
            frac_part += pair

    while len(int_part) < (exponent + 1) * 2:
        int_part += "00"

    int_part = int_part.lstrip("0") or "0"
    frac_part = frac_part.rstrip("0")

    out = int_part + ("." + frac_part if frac_part else "")
    return ("-" if not positive else "") + out


def decode_date(b: bytes) -> str:
    """Oracle's 7-byte DATE: century, year, month, day, hour, minute, second."""
    if len(b) < 7:
        return ""
    century, year, month, day, hh, mm, ss = b[0], b[1], b[2], b[3], b[4], b[5], b[6]
    y = (century - 100) * 100 + (year - 100)
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return ""
    stamp = f"{day:02d}/{month:02d}/{y:04d}"
    if (hh - 1, mm - 1, ss - 1) != (0, 0, 0):
        stamp += f" {hh - 1:02d}:{mm - 1:02d}:{ss - 1:02d}"
    return stamp


def decode(value: bytes, kind: str) -> str:
    if kind == "NUMBER":
        return decode_number(value)
    if kind == "DATE":
        return decode_date(value)
    return value.decode("utf-8", errors="replace").rstrip("\x00").strip()


# ---------------------------------------------------------------------------
# Dump parsing
# ---------------------------------------------------------------------------

COL_RE = re.compile(r'"([A-Z0-9_#$]+)"\s+([A-Z0-9]+)', re.I)


def column_list(ddl: str) -> str:
    """The text between the column list's own parentheses.

    Counted by depth rather than taken to the last ')': the statement ends with
    a STORAGE(...) clause, and slicing to `rindex(')')` swallows it, inventing
    extra "columns" out of tablespace names. That makes the declared column
    count disagree with the descriptor and quietly breaks the whole parse.
    """
    start = ddl.index("(")
    depth = 0
    for i in range(start, len(ddl)):
        if ddl[i] == "(":
            depth += 1
        elif ddl[i] == ")":
            depth -= 1
            if depth == 0:
                return ddl[start + 1:i]
    return ""


def table_columns(ddl: str) -> list[tuple[str, str]]:
    """Column names and coarse types from a CREATE TABLE statement."""
    body = column_list(ddl) if "(" in ddl else ""
    out: list[tuple[str, str]] = []
    for name, typ in COL_RE.findall(body):
        t = typ.upper()
        kind = "NUMBER" if t.startswith("NUMBER") else "DATE" if t == "DATE" else "TEXT"
        out.append((name, kind))
    return out


def parse_rows(data: bytes, start: int, kinds: list[str]) -> tuple[list[list[str]], int] | None:
    """Read rows from `start` until the FF FF terminator.

    Returns None when the offset does not parse cleanly — which is how a wrong
    guess at the row-data offset is rejected instead of producing garbage.
    """
    n = len(kinds)
    pos = start
    rows: list[list[str]] = []
    row: list[str] = []
    limit = len(data)

    while pos + 2 <= limit:
        length = int.from_bytes(data[pos:pos + 2], "little")
        pos += 2

        if length == END:
            # Only a clean break if we are not mid-row.
            return (rows, pos) if not row else None

        # EVERY row ends with a zero-length marker — not just the last one.
        # Oracle stores an empty string as NULL, so a genuine field is never
        # zero-length and this is unambiguous. It is also what makes a
        # misaligned offset fail fast instead of producing a shifted CSV.
        if length == 0:
            if len(row) != n:
                return None
            rows.append(row)
            row = []
            if len(rows) > 2_000_000:
                return None
            continue

        if len(row) >= n:
            return None

        if length == NULL:
            row.append("")
        else:
            if length > 8000 or pos + length > limit:
                return None
            row.append(decode(data[pos:pos + length], kinds[len(row)]))
            pos += length

    return None


def extract(path: str, wanted: set[str], out_dir: str) -> dict[str, int]:
    data = open(path, "rb").read()
    os.makedirs(out_dir, exist_ok=True)
    counts: dict[str, int] = {}
    seen: dict[str, int] = {}

    for m in re.finditer(rb'CREATE TABLE "([A-Z0-9_#$]+)"', data):
        name = m.group(1).decode()
        if name not in wanted:
            continue

        ddl_end = data.find(b"\n", m.start())
        ddl = data[m.start():ddl_end].decode("latin-1", errors="replace")
        cols = table_columns(ddl)
        if not cols:
            continue

        ins = data.find(b'INSERT INTO "%s"' % name.encode(), ddl_end)
        if ins == -1:
            continue
        after = data.find(b"\n", ins) + 1

        kinds = [k for _, k in cols]

        # Compute where the rows start rather than guessing at it.
        #
        # The block between the INSERT and the first row is:
        #     2 bytes  column count
        #     per column: 8 bytes for a character type, 4 for everything else
        #     4 bytes  separator
        #
        # Guessing this by trying offsets can land on a misaligned start that
        # still parses to the terminator, which produces a plausible-looking
        # CSV with every field shifted by one. That is the worst possible
        # failure here, because it is silent.
        parsed = None
        declared = int.from_bytes(data[after:after + 2], "little")
        if declared == len(cols):
            pos = after + 2
            for _ in range(declared):
                col_type = int.from_bytes(data[pos:pos + 2], "little")
                pos += 8 if col_type == 1 else 4
            got = parse_rows(data, pos + 4, kinds)
            if got is not None:
                parsed = got[0]

        # Fallback: the descriptor did not look as expected, so scan for an
        # offset that parses cleanly.
        if parsed is None:
            for off in range(0, 400):
                got = parse_rows(data, after + off, kinds)
                if got is not None and got[0]:
                    parsed = got[0]
                    break

        if parsed is None:
            counts[f"{name}#{seen.get(name,0)+1}"] = -1
            continue

        # Every table appears more than once in this dump. Each occurrence is
        # written separately rather than letting a later one overwrite an
        # earlier one — which is what silently happened first time round, and
        # would have thrown away a whole schema's rows without a word.
        seen[name] = seen.get(name, 0) + 1
        suffix = "" if seen[name] == 1 else f"__{seen[name]}"
        target = os.path.join(out_dir, f"{name}{suffix}.csv")
        with io.open(target, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh, quoting=csv.QUOTE_ALL)
            w.writerow([c for c, _ in cols])
            w.writerows(parsed)
        counts[f"{name}{suffix}"] = len(parsed)

    return counts


if __name__ == "__main__":
    dmp, out = sys.argv[1], sys.argv[2]
    tables = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else set()
    for t, c in sorted(extract(dmp, tables, out).items()):
        print(f"{t:<16} {'PARSE FAILED' if c < 0 else f'{c} rows'}")
