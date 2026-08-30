"""
Phase 5C — idempotency and transaction integrity under REAL PostgreSQL.

Everything here runs against PostgreSQL 18 with a real connection pool, so
concurrent requests genuinely race inside the database rather than being
serialised by a shared test session. This is the evidence that was explicitly
missing from Phase 5B, where the harness was aiosqlite.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import text

import app.db.session as db_session_mod

from tests._helpers import auth, login
from tests_pg._payload import build_payload, seed_shop


# asyncpg pools bind to the loop that created them; one shared loop for the
# whole module keeps connections valid across tests.
pytestmark = pytest.mark.asyncio(loop_scope="session")


def _paise(value) -> int:
    return int((Decimal(value) * 100).to_integral_value())


async def _scalar(sql: str, **params):
    async with db_session_mod.engine.connect() as conn:
        return await conn.scalar(text(sql), params)


# ---------------------------------------------------------------- environment


async def test_we_are_really_on_postgres(client: AsyncClient) -> None:
    """Guard: if this ever reports SQLite, every result below is worthless."""
    version = await _scalar("SELECT version()")
    assert "PostgreSQL" in version, version

    schema = await _scalar("SELECT current_schema()")
    assert schema == "p5c_test", f"tests escaped the isolated schema: {schema}"


async def test_the_unique_constraint_actually_exists_in_postgres(
    client: AsyncClient,
) -> None:
    """The whole idempotency guarantee rests on this constraint being real."""
    name = await _scalar(
        """
        SELECT conname FROM pg_constraint
         WHERE conname = 'uq_sales_client_uuid'
           AND connamespace = 'p5c_test'::regnamespace
        """
    )
    assert name == "uq_sales_client_uuid"


# --------------------------------------------------------------- concurrency


async def _run_concurrent(client: AsyncClient, shop: dict, built: dict, n: int):
    results = await asyncio.gather(
        *[
            client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
            for _ in range(n)
        ],
        return_exceptions=True,
    )
    responses = [r for r in results if not isinstance(r, Exception)]
    raised = [r for r in results if isinstance(r, Exception)]
    ok = [r for r in responses if r.status_code == 201]
    server_errors = [r for r in responses if r.status_code >= 500]
    return responses, raised, ok, server_errors


@pytest.mark.parametrize("run", [1, 2, 3])
async def test_10_concurrent_same_client_uuid_creates_one_sale(
    client: AsyncClient, run: int
) -> None:
    """Repeated deliberately — a race that passes once has proved very little."""
    shop = await seed_shop(client)
    built = build_payload(shop["store_id"], shop["variant_id"])

    responses, raised, ok, server_errors = await _run_concurrent(client, shop, built, 10)

    assert not raised, f"transport raised: {raised}"
    assert not server_errors, (
        f"run {run}: {len(server_errors)} request(s) returned 5xx — "
        f"the IntegrityError race was not handled: "
        f"{[r.text[:200] for r in server_errors]}"
    )
    assert ok, "no request succeeded"
    assert len({r.json()["id"] for r in ok}) == 1, "concurrent writes created different sales"

    rows = await _scalar("SELECT count(*) FROM sales")
    assert rows == 1, f"PostgreSQL holds {rows} sales for one client_uuid"

    distinct = await _scalar("SELECT count(DISTINCT client_uuid) FROM sales")
    assert distinct == 1


async def test_25_concurrent_same_client_uuid(client: AsyncClient) -> None:
    shop = await seed_shop(client)
    built = build_payload(shop["store_id"], shop["variant_id"])

    responses, raised, ok, server_errors = await _run_concurrent(client, shop, built, 25)

    assert not raised, f"transport raised: {raised}"
    assert not server_errors, [r.text[:200] for r in server_errors]
    assert len({r.json()["id"] for r in ok}) == 1
    assert await _scalar("SELECT count(*) FROM sales") == 1


async def test_50_concurrent_same_client_uuid(client: AsyncClient) -> None:
    shop = await seed_shop(client)
    built = build_payload(shop["store_id"], shop["variant_id"])

    responses, raised, ok, server_errors = await _run_concurrent(client, shop, built, 50)

    assert not raised, f"transport raised: {raised}"
    assert not server_errors, [r.text[:200] for r in server_errors]
    assert len({r.json()["id"] for r in ok}) == 1
    assert await _scalar("SELECT count(*) FROM sales") == 1


async def test_concurrent_distinct_client_uuids_all_persist(
    client: AsyncClient,
) -> None:
    """The mirror image: 10 genuinely different bills must all survive."""
    shop = await seed_shop(client)
    payloads = [
        build_payload(shop["store_id"], shop["variant_id"])["payload"] for _ in range(10)
    ]

    results = await asyncio.gather(
        *[
            client.post("/api/v1/sales", headers=shop["headers"], json=p)
            for p in payloads
        ],
        return_exceptions=True,
    )
    ok = [r for r in results if not isinstance(r, Exception) and r.status_code == 201]

    assert len(ok) == 10, "idempotency handling swallowed distinct sales"
    assert len({r.json()["id"] for r in ok}) == 10
    assert await _scalar("SELECT count(*) FROM sales") == 10


# ------------------------------------------------------- transaction integrity


async def test_concurrent_race_leaves_no_orphans(client: AsyncClient) -> None:
    """
    The losers of the race roll back. Their lines, payments and stock
    movements must roll back with them — a rolled-back sale that still moved
    inventory would corrupt stock silently.
    """
    shop = await seed_shop(client)
    built = build_payload(shop["store_id"], shop["variant_id"])

    await _run_concurrent(client, shop, built, 25)

    sales = await _scalar("SELECT count(*) FROM sales")
    lines = await _scalar("SELECT count(*) FROM sale_lines")
    payments = await _scalar("SELECT count(*) FROM sale_payments")
    assert sales == 1
    assert lines == 1, f"{lines} line rows for a single-line sale"
    assert payments == 1, f"{payments} payment rows for one payment"

    orphan_lines = await _scalar(
        "SELECT count(*) FROM sale_lines l WHERE NOT EXISTS "
        "(SELECT 1 FROM sales s WHERE s.id = l.sale_id)"
    )
    orphan_payments = await _scalar(
        "SELECT count(*) FROM sale_payments p WHERE NOT EXISTS "
        "(SELECT 1 FROM sales s WHERE s.id = p.sale_id)"
    )
    assert orphan_lines == 0
    assert orphan_payments == 0


async def test_concurrent_race_moves_stock_exactly_once(client: AsyncClient) -> None:
    """25 racing requests, one sale — therefore exactly one stock movement."""
    shop = await seed_shop(client)
    built = build_payload(shop["store_id"], shop["variant_id"])

    await _run_concurrent(client, shop, built, 25)

    movements = await _scalar(
        "SELECT count(*) FROM stock_movements WHERE reference_type = 'sale'"
    )
    assert movements == 1, f"{movements} stock movements for one sale"

    qty = await _scalar(
        "SELECT COALESCE(sum(delta), 0) FROM stock_movements WHERE reference_type = 'sale'"
    )
    assert Decimal(qty) == Decimal("-1"), f"stock moved by {qty}, expected -1"


async def test_rejected_payload_leaves_nothing_behind(client: AsyncClient) -> None:
    """A validation failure must not half-write a bill or move stock."""
    shop = await seed_shop(client)
    built = build_payload(shop["store_id"], shop["variant_id"])
    built["payload"]["lines"][0]["line_total"] = "1.00"  # far outside tolerance

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 422

    assert await _scalar("SELECT count(*) FROM sales") == 0
    assert await _scalar("SELECT count(*) FROM sale_lines") == 0
    assert await _scalar("SELECT count(*) FROM sale_payments") == 0
    assert await _scalar(
        "SELECT count(*) FROM stock_movements WHERE reference_type = 'sale'"
    ) == 0


# ---------------------------------------------------------------- idempotency


async def test_mismatched_payload_is_rejected_and_original_survives(
    client: AsyncClient,
) -> None:
    shop = await seed_shop(client)
    built = build_payload(shop["store_id"], shop["variant_id"])

    first = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert first.status_code == 201
    original_total = first.json()["grand_total"]

    conflicting = json.loads(json.dumps(built["payload"]))
    conflicting["lines"][0]["quantity"] = "9.000"

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=conflicting)
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "CLIENT_UUID_PAYLOAD_MISMATCH"

    assert await _scalar("SELECT count(*) FROM sales") == 1
    stored = await _scalar("SELECT grand_total FROM sales LIMIT 1")
    assert Decimal(stored) == Decimal(original_total), "the stored sale was altered"


async def test_commit_then_lost_response_retry_returns_the_same_sale(
    client: AsyncClient,
) -> None:
    shop = await seed_shop(client)
    built = build_payload(shop["store_id"], shop["variant_id"])

    committed = await client.post(
        "/api/v1/sales", headers=shop["headers"], json=built["payload"]
    )
    assert committed.status_code == 201
    # The terminal never saw that response and retries after restarting.
    replay = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])

    assert replay.status_code == 201
    assert replay.json()["id"] == committed.json()["id"]
    assert replay.json()["number"] == committed.json()["number"]
    assert await _scalar("SELECT count(*) FROM sales") == 1
    assert await _scalar(
        "SELECT count(*) FROM stock_movements WHERE reference_type = 'sale'"
    ) == 1


# ------------------------------------------------------- financial invariant


@pytest.mark.parametrize(
    "scenario", ["standard", "rounded", "multiline", "fractional", "awkward", "credit"]
)
async def test_financial_invariant_against_postgres(
    client: AsyncClient, scenario: str
) -> None:
    """RECEIPT == SQLITE == POSTGRESQL, read back out of PostgreSQL itself."""
    shop = await seed_shop(client)
    built = build_payload(shop["store_id"], shop["variant_id"], scenario)
    sent = built["payload"]

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=sent)
    assert r.status_code == 201, r.text
    body = r.json()

    # Read the stored values straight from PostgreSQL, not from the response.
    stored_total = await _scalar("SELECT grand_total FROM sales LIMIT 1")
    stored_tax = await _scalar("SELECT tax_total FROM sales LIMIT 1")
    stored_paid = await _scalar("SELECT paid_total FROM sales LIMIT 1")
    stored_uuid = await _scalar("SELECT client_uuid FROM sales LIMIT 1")

    assert _paise(stored_total) == built["local"]["totalPaise"], scenario
    assert _paise(stored_tax) == built["local"]["taxPaise"], scenario
    assert stored_uuid == sent["client_uuid"]
    assert _paise(stored_paid) == sum(_paise(p["amount"]) for p in sent["payments"])

    # ...and the API response agrees with the table.
    assert _paise(body["grand_total"]) == _paise(stored_total)

    for sent_line, stored in zip(sent["lines"], body["lines"]):
        assert stored["variant_id"] == sent_line["variant_id"]
        assert Decimal(stored["quantity"]) == Decimal(sent_line["quantity"])
        assert _paise(stored["unit_price"]) == _paise(sent_line["unit_price"])
        assert Decimal(stored["discount_pct"]) == Decimal(sent_line["discount_pct"])
        assert _paise(stored["line_total"]) == _paise(sent_line["line_total"])
        assert Decimal(stored["tax_rate"]) == Decimal(sent_line["tax_rate"])


async def test_tax_snapshot_holds_in_postgres(client: AsyncClient) -> None:
    shop = await seed_shop(client)
    built = build_payload(shop["store_id"], shop["variant_id"], "tax18")

    r = await client.patch(
        f"/api/v1/products/{shop['product_id']}",
        headers=shop["headers"],
        json={"tax_rate": "12.00"},
    )
    assert r.status_code == 200

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 201, r.text

    rate = await _scalar("SELECT tax_rate FROM sale_lines LIMIT 1")
    assert Decimal(rate) == Decimal("18.00"), "PostgreSQL stored today's rate, not the snapshot"
    assert _paise(await _scalar("SELECT tax_total FROM sales LIMIT 1")) == built["local"]["taxPaise"]


async def test_customer_and_store_identity_persist(client: AsyncClient) -> None:
    shop = await seed_shop(client)
    built = build_payload(shop["store_id"], shop["variant_id"])

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 201

    store_id = await _scalar("SELECT store_id::text FROM sales LIMIT 1")
    assert store_id == shop["store_id"]


# ------------------------------------------------------- legacy online path


async def test_legacy_payload_without_new_fields_still_works_on_postgres(
    client: AsyncClient,
) -> None:
    shop = await seed_shop(client)
    legacy = {
        "store_id": shop["store_id"],
        "customer_id": None,
        "salesperson_user_id": None,
        "lines": [
            {
                "variant_id": shop["variant_id"],
                "quantity": "1",
                "unit_price": "343.00",
                "discount_pct": "30.00",
            }
        ],
        "payments": [{"method": "cash", "amount": "240.10", "reference": None}],
        "notes": None,
        "client_uuid": str(uuid.uuid4()),
    }

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=legacy)
    assert r.status_code == 201, r.text
    # Unchanged pre-5B behaviour: the server derives 240.10.
    assert _paise(await _scalar("SELECT grand_total FROM sales LIMIT 1")) == 24010


async def test_legacy_payload_without_client_uuid_still_works(
    client: AsyncClient,
) -> None:
    """client_uuid is optional; sales without one must not collide."""
    shop = await seed_shop(client)
    base = {
        "store_id": shop["store_id"],
        "customer_id": None,
        "salesperson_user_id": None,
        "lines": [
            {"variant_id": shop["variant_id"], "quantity": "1", "unit_price": "343.00",
             "discount_pct": "0"}
        ],
        "payments": [{"method": "cash", "amount": "343.00", "reference": None}],
        "notes": None,
    }

    first = await client.post("/api/v1/sales", headers=shop["headers"], json=base)
    second = await client.post("/api/v1/sales", headers=shop["headers"], json=base)

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["id"] != second.json()["id"]
    # A NULL client_uuid must not be treated as a duplicate by the constraint.
    assert await _scalar("SELECT count(*) FROM sales") == 2
