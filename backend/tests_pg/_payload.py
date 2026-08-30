"""
Shared payload/seed helpers for the PostgreSQL suite.

Originally Phase 5 — the REAL Electron payload against the REAL FastAPI.

The payload is not hand-written here. It is produced by running the actual
TypeScript payload builder over an actual SQLite sale committed by the actual
SaleRepository, then POSTed byte-for-byte. If the builder is wrong, these
tests fail — which is the only reason they are worth running.

CAVEAT, stated plainly: the backend test harness runs on aiosqlite, not
PostgreSQL. The endpoint, Pydantic schemas, service logic and SQLAlchemy
models are the real ones; the SQL engine is not. Anything that depends on
PostgreSQL-specific behaviour — notably the uq_sales_client_uuid constraint
under genuine write concurrency — is NOT proven by these tests.
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from decimal import Decimal
from pathlib import Path

import pytest
from httpx import AsyncClient

from tests._helpers import auth, login

# Pinned: this file is executed from inside backend/tests so that it
# inherits the real conftest, but the harness lives in the scratchpad.
SCRATCH = Path(os.environ.get("P5_SCRATCH", Path(__file__).parent))
EXPORTER = SCRATCH / "export-payload.cjs"
DESKTOP_MODULES = r"C:\Users\singh\Desktop\Retail OS\desktop\node_modules"


def build_payload(store_id: str, variant_id: str, scenario: str = "standard") -> dict:
    """Run the REAL TypeScript builder and return exactly what it emitted."""
    out = SCRATCH / f"payload-{uuid.uuid4().hex}.json"
    env = {**os.environ, "NODE_PATH": DESKTOP_MODULES}
    proc = subprocess.run(
        ["node", str(EXPORTER), store_id, variant_id, str(out), scenario],
        capture_output=True,
        text=True,
        env=env,
    )
    assert proc.returncode == 0, f"exporter failed:\n{proc.stdout}\n{proc.stderr}"
    data = json.loads(out.read_text(encoding="utf-8"))
    out.unlink()
    return data


async def seed_shop(client: AsyncClient, *, open_session: bool = True) -> dict:
    """Create the minimum real backend state a sale needs."""
    token = await login(client)
    h = auth(token)

    r = await client.post(
        "/api/v1/stores",
        headers=h,
        json={"code": f"MS{uuid.uuid4().hex[:6]}", "name": "MS Mall", "city": "Madanpur"},
    )
    assert r.status_code == 201, r.text
    store_id = r.json()["id"]

    r = await client.post(
        "/api/v1/units",
        headers=h,
        json={"name": "Piece", "symbol": "pc", "is_fractional": True, "is_active": True},
    )
    assert r.status_code == 201, r.text
    unit_id = r.json()["id"]

    # 5% GST, matching the tax_rate_bp=500 the offline sale snapshotted.
    r = await client.post(
        "/api/v1/products",
        headers=h,
        json={
            "name": "SHORT KURTI 660",
            "hsn_code": "6211",
            "tax_rate": "5.00",
            "unit_id": unit_id,
            "variants": [
                {
                    "name": "Free Size",
                    "sku": "160055.003",
                    "barcode": "8901234567890",
                    "cost_price": "150.00",
                    "mrp": "343.00",
                    "selling_price": "240.00",
                }
            ],
        },
    )
    assert r.status_code == 201, r.text
    product = r.json()
    variant_id = product["variants"][0]["id"]

    session_id = None
    if open_session:
        r = await client.post(
            "/api/v1/day-sessions/open",
            headers=h,
            json={"store_id": store_id, "opening_cash": "0.00"},
        )
        assert r.status_code == 201, r.text
        session_id = r.json()["id"]

    return {
        "headers": h,
        "store_id": store_id,
        "variant_id": variant_id,
        "product_id": product["id"],
        "session_id": session_id,
    }


