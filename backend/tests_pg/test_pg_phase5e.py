"""
Phase 5E — explicit session attribution, terminal identity, invoice month.

Against REAL PostgreSQL. The payloads are produced by the REAL TypeScript
builder over a REAL SQLite sale, so what is POSTed here is what a till would
actually send.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import text

import app.db.session as db_session_mod

from tests_pg._payload import build_payload, seed_shop

pytestmark = pytest.mark.asyncio(loop_scope="session")

TERMINAL_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
TERMINAL_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"


def _paise(value) -> int:
    return int((Decimal(value) * 100).to_integral_value())


async def _scalar(sql: str, **params):
    async with db_session_mod.engine.connect() as conn:
        return await conn.scalar(text(sql), params)


async def _fetch(sql: str, **params):
    async with db_session_mod.engine.connect() as conn:
        return (await conn.execute(text(sql), params)).mappings().all()


def attributed(
    store_id: str,
    variant_id: str,
    *,
    session_id: str | None = None,
    terminal: str | None = None,
    occurred_at: str | None = None,
    scenario: str = "standard",
) -> dict:
    """Build a payload through the real builder with explicit attribution."""
    prev = {k: os.environ.get(k) for k in
            ("P5E_DAY_SESSION_ID", "P5E_TERMINAL_UUID", "P5E_OCCURRED_AT")}
    for key, value in (
        ("P5E_DAY_SESSION_ID", session_id),
        ("P5E_TERMINAL_UUID", terminal),
        ("P5E_OCCURRED_AT", occurred_at),
    ):
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    try:
        return build_payload(store_id, variant_id, scenario)
    finally:
        for key, value in prev.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


async def _close_session(client: AsyncClient, shop: dict, counted: str = "0.00"):
    r = await client.post(
        f"/api/v1/day-sessions/{shop['session_id']}/close",
        headers=shop["headers"],
        json={"counted_cash": counted},
    )
    assert r.status_code == 200, r.text
    return r.json()


# ============================================================ A. SESSION


async def test_online_sale_with_open_session_unchanged(client: AsyncClient) -> None:
    """No attribution supplied → the pre-5E path, untouched."""
    shop = await seed_shop(client)
    built = attributed(shop["store_id"], shop["variant_id"])
    assert built["payload"]["day_session_id"] is None

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 201, r.text
    assert str(await _scalar("SELECT day_session_id FROM sales LIMIT 1")) == shop["session_id"]


async def test_offline_sale_reconnects_while_session_still_open(
    client: AsyncClient,
) -> None:
    shop = await seed_shop(client)
    built = attributed(
        shop["store_id"], shop["variant_id"],
        session_id=shop["session_id"], terminal=TERMINAL_A,
    )

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 201, r.text
    assert str(await _scalar("SELECT day_session_id FROM sales LIMIT 1")) == shop["session_id"]


async def test_late_sale_attaches_to_the_CLOSED_session_not_todays(
    client: AsyncClient,
) -> None:
    """
    THE HEADLINE FIX.

    Yesterday's shift closes. A new shift opens. The overnight offline bill
    then syncs. It must land on YESTERDAY's session.
    """
    shop = await seed_shop(client)
    yesterday = shop["session_id"]
    built = attributed(
        shop["store_id"], shop["variant_id"],
        session_id=yesterday, terminal=TERMINAL_A,
        occurred_at="2026-03-31T18:05:00.000Z",
    )

    await _close_session(client, shop)
    r = await client.post(
        "/api/v1/day-sessions/open",
        headers=shop["headers"],
        json={"store_id": shop["store_id"], "opening_cash": "0.00"},
    )
    assert r.status_code == 201
    today = r.json()["id"]

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 201, r.text

    attached = str(await _scalar("SELECT day_session_id FROM sales LIMIT 1"))
    assert attached == yesterday, "late sale was booked into the wrong shift"
    assert attached != today


async def test_wrong_store_session_is_rejected(client: AsyncClient) -> None:
    """A terminal must not be able to book into another store's shift."""
    shop_a = await seed_shop(client)

    # A SECOND store with its own open session, reusing the same operator —
    # seed_shop() would try to re-seed the same user and collide on email.
    r = await client.post(
        "/api/v1/stores",
        headers=shop_a["headers"],
        json={"code": f"OT{uuid.uuid4().hex[:6]}", "name": "Other Mall"},
    )
    assert r.status_code == 201, r.text
    other_store = r.json()["id"]
    r = await client.post(
        "/api/v1/day-sessions/open",
        headers=shop_a["headers"],
        json={"store_id": other_store, "opening_cash": "0.00"},
    )
    assert r.status_code == 201, r.text
    other_session = r.json()["id"]

    built = attributed(
        shop_a["store_id"], shop_a["variant_id"], session_id=other_session
    )
    r = await client.post("/api/v1/sales", headers=shop_a["headers"], json=built["payload"])

    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "DAY_SESSION_STORE_MISMATCH"
    assert await _scalar("SELECT count(*) FROM sales") == 0


async def test_unknown_session_is_rejected_and_none_is_created(
    client: AsyncClient,
) -> None:
    shop = await seed_shop(client)
    before = await _scalar("SELECT count(*) FROM day_sessions")

    built = attributed(shop["store_id"], shop["variant_id"], session_id=str(uuid.uuid4()))
    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "DAY_SESSION_NOT_FOUND"
    assert await _scalar("SELECT count(*) FROM sales") == 0
    # No fake session invented to make the sale fit.
    assert await _scalar("SELECT count(*) FROM day_sessions") == before


async def test_restatement_recomputes_expected_cash_and_diff(
    client: AsyncClient,
) -> None:
    shop = await seed_shop(client)
    session_id = shop["session_id"]
    built = attributed(
        shop["store_id"], shop["variant_id"],
        session_id=session_id, terminal=TERMINAL_A, scenario="rounded",
    )  # 240.00 cash

    closed = await _close_session(client, shop, counted="500.00")
    prev_expected = Decimal(closed["expected_cash"])
    prev_diff = Decimal(closed["cash_diff"])
    assert prev_expected == Decimal("0.00")
    assert prev_diff == Decimal("500.00")

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 201, r.text

    row = (await _fetch(
        "SELECT expected_cash, cash_diff, counted_cash, closed_at, restated_at "
        "FROM day_sessions WHERE id = :i", i=uuid.UUID(session_id)))[0]

    # The till should have held the late sale's cash too.
    assert Decimal(row["expected_cash"]) == Decimal("240.00")
    assert Decimal(row["cash_diff"]) == Decimal("260.00")
    # What a human physically counted, and when they signed off, are facts.
    assert Decimal(row["counted_cash"]) == Decimal("500.00")
    assert row["closed_at"] is not None
    assert row["restated_at"] is not None


async def test_restatement_writes_an_audit_record(client: AsyncClient) -> None:
    shop = await seed_shop(client)
    session_id = shop["session_id"]
    built = attributed(
        shop["store_id"], shop["variant_id"],
        session_id=session_id, scenario="rounded",
    )
    await _close_session(client, shop, counted="500.00")

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 201
    sale_id = r.json()["id"]

    rows = await _fetch(
        "SELECT action, entity_type, entity_id, summary, changes FROM audit_logs "
        "WHERE action = 'day_session.restated'"
    )
    assert len(rows) == 1, "restatement was not audited"
    rec = rows[0]
    assert str(rec["entity_id"]) == session_id
    changes = rec["changes"] if isinstance(rec["changes"], dict) else json.loads(rec["changes"])

    # Every question the audit must answer.
    assert changes["caused_by_sale_id"] == sale_id
    assert changes["day_session_id"] == session_id
    assert changes["restated_at"]
    assert changes["previous_expected_cash"] == "0.00"
    assert changes["new_expected_cash"] == "240.00"
    assert changes["previous_cash_diff"] == "500.00"
    assert changes["new_cash_diff"] == "260.00"
    assert changes["reason"] == "late_arriving_offline_sale"


async def test_multiple_late_sales_restate_cumulatively(client: AsyncClient) -> None:
    shop = await seed_shop(client)
    session_id = shop["session_id"]
    builts = [
        attributed(shop["store_id"], shop["variant_id"],
                   session_id=session_id, scenario="rounded")
        for _ in range(3)
    ]
    await _close_session(client, shop, counted="1000.00")

    for b in builts:
        r = await client.post("/api/v1/sales", headers=shop["headers"], json=b["payload"])
        assert r.status_code == 201, r.text

    expected = await _scalar(
        "SELECT expected_cash FROM day_sessions WHERE id = :i", i=uuid.UUID(session_id))
    assert Decimal(expected) == Decimal("720.00"), "3 x 240.00 must accumulate"
    assert len(await _fetch(
        "SELECT id FROM audit_logs WHERE action='day_session.restated'")) == 3


async def test_open_session_sale_does_not_restate(client: AsyncClient) -> None:
    """Normal path must not be marked as a restatement."""
    shop = await seed_shop(client)
    built = attributed(
        shop["store_id"], shop["variant_id"], session_id=shop["session_id"])

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 201

    assert await _scalar(
        "SELECT restated_at FROM day_sessions WHERE id = :i",
        i=uuid.UUID(shop["session_id"])) is None
    assert await _scalar(
        "SELECT count(*) FROM audit_logs WHERE action='day_session.restated'") == 0


async def test_two_open_sessions_per_store_are_impossible(client: AsyncClient) -> None:
    """The invariant is now the database's job, not just the service's."""
    shop = await seed_shop(client)
    with pytest.raises(Exception):
        async with db_session_mod.engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO day_sessions (id, store_id, status, opened_at, "
                    "opening_cash, created_at, updated_at) VALUES "
                    "(:id, :s, 'open', now(), 0, now(), now())"
                ),
                {"id": uuid.uuid4(), "s": uuid.UUID(shop["store_id"])},
            )


# ============================================================ B. TERMINAL


async def test_two_terminals_same_session_stay_distinguishable(
    client: AsyncClient,
) -> None:
    shop = await seed_shop(client)
    a = attributed(shop["store_id"], shop["variant_id"],
                   session_id=shop["session_id"], terminal=TERMINAL_A)
    b = attributed(shop["store_id"], shop["variant_id"],
                   session_id=shop["session_id"], terminal=TERMINAL_B, scenario="rounded")

    for built in (a, b):
        r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
        assert r.status_code == 201, r.text

    rows = await _fetch(
        "SELECT terminal_uuid, count(*) n, sum(grand_total) total "
        "FROM sales GROUP BY terminal_uuid ORDER BY terminal_uuid")
    assert len(rows) == 2, "the two tills were merged into one"
    by_terminal = {r["terminal_uuid"]: r for r in rows}
    assert by_terminal[TERMINAL_A]["n"] == 1
    assert by_terminal[TERMINAL_B]["n"] == 1
    # Per-terminal reconciliation is now answerable.
    assert Decimal(by_terminal[TERMINAL_B]["total"]) == Decimal("240.00")


async def test_terminal_uuid_is_returned_for_reconciliation(
    client: AsyncClient,
) -> None:
    shop = await seed_shop(client)
    built = attributed(shop["store_id"], shop["variant_id"],
                       session_id=shop["session_id"], terminal=TERMINAL_A)
    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.json()["terminal_uuid"] == TERMINAL_A


async def test_sale_without_terminal_is_still_accepted(client: AsyncClient) -> None:
    """Unknown terminal is a reporting gap, never a refused bill."""
    shop = await seed_shop(client)
    built = attributed(shop["store_id"], shop["variant_id"], session_id=shop["session_id"])
    assert built["payload"]["terminal_uuid"] is None

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 201
    assert await _scalar("SELECT terminal_uuid FROM sales LIMIT 1") is None


async def test_malformed_terminal_uuid_is_rejected(client: AsyncClient) -> None:
    shop = await seed_shop(client)
    built = attributed(shop["store_id"], shop["variant_id"], session_id=shop["session_id"])
    built["payload"]["terminal_uuid"] = "bad uuid!! with spaces"

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 422
    assert await _scalar("SELECT count(*) FROM sales") == 0


# ====================================================== C. INVOICE NUMBER


async def test_march_sale_synced_in_april_gets_a_march_number(
    client: AsyncClient,
) -> None:
    """THE INVOICE-MONTH FIX."""
    shop = await seed_shop(client)
    built = attributed(
        shop["store_id"], shop["variant_id"],
        session_id=shop["session_id"],
        occurred_at="2026-03-31T18:05:00.000Z",
    )

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 201, r.text
    number = r.json()["number"]

    assert "-202603-" in number, f"expected a March sequence, got {number}"
    seqs = await _fetch("SELECT year_month, next_seq FROM sale_number_sequences")
    assert [s["year_month"] for s in seqs] == ["202603"]


async def test_occurred_at_is_preserved_exactly(client: AsyncClient) -> None:
    shop = await seed_shop(client)
    built = attributed(
        shop["store_id"], shop["variant_id"],
        session_id=shop["session_id"],
        occurred_at="2026-03-31T18:05:00.000Z",
    )
    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 201

    stored = await _scalar("SELECT occurred_at FROM sales LIMIT 1")
    assert stored.astimezone(timezone.utc) == datetime(
        2026, 3, 31, 18, 5, tzinfo=timezone.utc
    ), "the original occurrence time was overwritten"


async def test_online_sale_without_occurred_at_uses_now(client: AsyncClient) -> None:
    shop = await seed_shop(client)
    built = attributed(shop["store_id"], shop["variant_id"])
    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 201

    now = datetime.now(timezone.utc)
    stored = await _scalar("SELECT occurred_at FROM sales LIMIT 1")
    assert abs(stored.astimezone(timezone.utc) - now) < timedelta(minutes=5)
    assert f"-{now.strftime('%Y%m')}-" in r.json()["number"]


async def test_sales_in_two_months_use_separate_sequences(
    client: AsyncClient,
) -> None:
    shop = await seed_shop(client)
    march = attributed(shop["store_id"], shop["variant_id"],
                       session_id=shop["session_id"],
                       occurred_at="2026-03-31T18:05:00.000Z")
    april = attributed(shop["store_id"], shop["variant_id"],
                       session_id=shop["session_id"],
                       occurred_at="2026-04-01T04:30:00.000Z")

    n1 = (await client.post("/api/v1/sales", headers=shop["headers"],
                            json=march["payload"])).json()["number"]
    n2 = (await client.post("/api/v1/sales", headers=shop["headers"],
                            json=april["payload"])).json()["number"]

    assert "-202603-" in n1 and "-202604-" in n2
    assert n1.endswith("0001") and n2.endswith("0001"), "sequences must be independent"


async def test_concurrent_numbering_produces_no_duplicates(
    client: AsyncClient,
) -> None:
    """Twelve distinct sales at once — every invoice number must be unique."""
    shop = await seed_shop(client)
    payloads = [
        attributed(shop["store_id"], shop["variant_id"],
                   session_id=shop["session_id"],
                   occurred_at="2026-03-31T18:05:00.000Z")["payload"]
        for _ in range(12)
    ]

    results = await asyncio.gather(
        *[client.post("/api/v1/sales", headers=shop["headers"], json=p) for p in payloads],
        return_exceptions=True,
    )
    ok = [r for r in results if not isinstance(r, Exception) and r.status_code == 201]
    assert len(ok) == 12, [
        r.text[:160] for r in results
        if not isinstance(r, Exception) and r.status_code != 201
    ]

    numbers = [r.json()["number"] for r in ok]
    assert len(set(numbers)) == 12, "duplicate invoice numbers under concurrency"
    assert all("-202603-" in n for n in numbers)
    assert await _scalar("SELECT count(DISTINCT number) FROM sales") == 12


# ====================================================== D. IDEMPOTENCY


async def test_replay_with_attribution_returns_one_sale(client: AsyncClient) -> None:
    shop = await seed_shop(client)
    built = attributed(shop["store_id"], shop["variant_id"],
                       session_id=shop["session_id"], terminal=TERMINAL_A)

    first = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    second = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])

    assert first.status_code == second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert await _scalar("SELECT count(*) FROM sales") == 1


@pytest.mark.parametrize("n", [10, 25, 50])
async def test_concurrent_replay_with_attribution(client: AsyncClient, n: int) -> None:
    shop = await seed_shop(client)
    built = attributed(shop["store_id"], shop["variant_id"],
                       session_id=shop["session_id"], terminal=TERMINAL_A)

    results = await asyncio.gather(
        *[client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
          for _ in range(n)],
        return_exceptions=True,
    )
    responses = [r for r in results if not isinstance(r, Exception)]
    assert not [r for r in responses if r.status_code >= 500]
    ok = [r for r in responses if r.status_code == 201]
    assert len({r.json()["id"] for r in ok}) == 1
    assert await _scalar("SELECT count(*) FROM sales") == 1
    # Attribution must survive the race intact.
    assert str(await _scalar("SELECT day_session_id FROM sales LIMIT 1")) == shop["session_id"]
    assert await _scalar("SELECT terminal_uuid FROM sales LIMIT 1") == TERMINAL_A


async def test_same_client_uuid_changed_attribution_is_rejected(
    client: AsyncClient,
) -> None:
    """An idempotency key may not be reused to re-point a stored sale."""
    shop = await seed_shop(client)
    built = attributed(shop["store_id"], shop["variant_id"],
                       session_id=shop["session_id"], terminal=TERMINAL_A)
    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 201

    conflicting = json.loads(json.dumps(built["payload"]))
    conflicting["lines"][0]["quantity"] = "9.000"
    r = await client.post("/api/v1/sales", headers=shop["headers"], json=conflicting)

    assert r.status_code == 409
    assert r.json()["error"]["code"] == "CLIENT_UUID_PAYLOAD_MISMATCH"
    assert str(await _scalar("SELECT day_session_id FROM sales LIMIT 1")) == shop["session_id"]
    assert await _scalar("SELECT terminal_uuid FROM sales LIMIT 1") == TERMINAL_A


# =================================================== F. RECONCILIATION


async def test_full_reconciliation_including_attribution(client: AsyncClient) -> None:
    shop = await seed_shop(client)
    built = attributed(
        shop["store_id"], shop["variant_id"],
        session_id=shop["session_id"], terminal=TERMINAL_A,
        occurred_at="2026-03-31T18:05:00.000Z", scenario="rounded",
    )
    sent = built["payload"]

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=sent)
    assert r.status_code == 201, r.text
    body = r.json()

    row = (await _fetch("SELECT * FROM sales LIMIT 1"))[0]

    # money
    assert _paise(row["grand_total"]) == built["local"]["totalPaise"]
    assert _paise(row["tax_total"]) == built["local"]["taxPaise"]
    assert _paise(row["subtotal"]) == built["local"]["subtotalPaise"]
    # identity + attribution
    assert row["client_uuid"] == sent["client_uuid"]
    assert str(row["store_id"]) == sent["store_id"]
    assert str(row["day_session_id"]) == sent["day_session_id"]
    assert row["terminal_uuid"] == sent["terminal_uuid"]
    assert row["occurred_at"].astimezone(timezone.utc) == datetime(
        2026, 3, 31, 18, 5, tzinfo=timezone.utc)
    # lines
    for sent_line, stored in zip(sent["lines"], body["lines"]):
        assert stored["variant_id"] == sent_line["variant_id"]
        assert _paise(stored["line_total"]) == _paise(sent_line["line_total"])
        assert Decimal(stored["tax_rate"]) == Decimal(sent_line["tax_rate"])
        assert Decimal(stored["discount_pct"]) == Decimal(sent_line["discount_pct"])
    # payments
    assert _paise(row["paid_total"]) == sum(_paise(p["amount"]) for p in sent["payments"])
    # internal consistency
    assert _paise(row["subtotal"]) + _paise(row["tax_total"]) == _paise(row["grand_total"])


# ============================================== PHASE 6 — VISIBILITY


async def test_restated_at_is_exposed_to_the_ui(client: AsyncClient) -> None:
    """
    The UI cannot warn about a restated shift it cannot see.

    Phase 5E set day_sessions.restated_at but never exposed it on
    DaySessionRead, so the flag was invisible to every client.
    """
    shop = await seed_shop(client)
    built = attributed(
        shop["store_id"], shop["variant_id"],
        session_id=shop["session_id"], scenario="rounded",
    )
    await _close_session(client, shop, counted="500.00")

    # /current returns only OPEN sessions, so a closed shift is read through
    # the list endpoint — the path the Day session screen actually uses.
    r = await client.get(
        "/api/v1/day-sessions",
        headers=shop["headers"],
        params={"store_id": shop["store_id"]},
    )
    assert r.status_code == 200, r.text
    closed = [s for s in r.json() if s["status"] == "closed"]
    assert len(closed) == 1
    assert "restated_at" in closed[0], "restated_at missing from DaySessionRead"
    assert closed[0]["restated_at"] is None

    r = await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])
    assert r.status_code == 201

    # After: the flag is visible, alongside the restated figures.
    body = [
        s for s in (await client.get(
            "/api/v1/day-sessions",
            headers=shop["headers"],
            params={"store_id": shop["store_id"]},
        )).json() if s["status"] == "closed"
    ][0]
    assert body["restated_at"] is not None
    assert Decimal(body["expected_cash"]) == Decimal("240.00")
    assert Decimal(body["cash_diff"]) == Decimal("260.00")
    # The facts a human established are untouched.
    assert Decimal(body["counted_cash"]) == Decimal("500.00")
    assert body["closed_at"] is not None


async def test_restatement_audit_is_queryable_by_session(client: AsyncClient) -> None:
    """The UI reads history through the existing audit endpoint, by entity."""
    shop = await seed_shop(client)
    session_id = shop["session_id"]
    built = attributed(
        shop["store_id"], shop["variant_id"], session_id=session_id, scenario="rounded")
    await _close_session(client, shop, counted="500.00")
    await client.post("/api/v1/sales", headers=shop["headers"], json=built["payload"])

    r = await client.get(
        "/api/v1/audit-logs",
        headers=shop["headers"],
        params={
            "action": "day_session.restated",
            "entity_type": "day_session",
            "entity_id": session_id,
        },
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1

    changes = items[0]["changes"]
    # Everything the history panel renders.
    for key in (
        "previous_expected_cash", "new_expected_cash",
        "previous_cash_diff", "new_cash_diff",
        "counted_cash_unchanged", "caused_by_sale_id", "reason",
    ):
        assert key in changes, f"audit record missing {key}"


async def test_session_list_returns_open_and_closed(client: AsyncClient) -> None:
    """The read path the Day session screen depends on."""
    shop = await seed_shop(client)
    await _close_session(client, shop, counted="0.00")
    r = await client.post(
        "/api/v1/day-sessions/open",
        headers=shop["headers"],
        json={"store_id": shop["store_id"], "opening_cash": "0.00"},
    )
    assert r.status_code == 201

    r = await client.get(
        "/api/v1/day-sessions",
        headers=shop["headers"],
        params={"store_id": shop["store_id"]},
    )
    assert r.status_code == 200, r.text
    statuses = [s["status"] for s in r.json()]
    assert "open" in statuses and "closed" in statuses
    # Newest first, so the current shift leads.
    assert statuses[0] == "open"


async def test_session_list_is_scoped_to_the_store(client: AsyncClient) -> None:
    shop = await seed_shop(client)
    r = await client.post(
        "/api/v1/stores",
        headers=shop["headers"],
        json={"code": f"XX{uuid.uuid4().hex[:6]}", "name": "Elsewhere"},
    )
    other = r.json()["id"]

    rows = (await client.get(
        "/api/v1/day-sessions", headers=shop["headers"],
        params={"store_id": other},
    )).json()
    assert rows == []
