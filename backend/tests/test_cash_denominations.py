"""Counting the drawer as notes, not as one typed number.

Closing a shift used to ask for a single figure. A fat-fingered digit in that
figure is indistinguishable from a genuinely short drawer, and the shop finds
out the next morning when nobody remembers what was in the till.

Counting by denomination is what a person does anyway when emptying a till.
Recording it makes the total derived rather than asserted: the arithmetic
cannot be wrong, and a discrepancy becomes investigable — "exactly one 500
short" — rather than merely noticed.
"""

from __future__ import annotations

from decimal import Decimal

from httpx import AsyncClient

from tests._helpers import auth, login


async def _open_till(client: AsyncClient, opening: str = "1000.00") -> dict:
    token = await login(client)
    h = auth(token)
    r = await client.post("/api/v1/stores", headers=h,
                          json={"code": "CD", "name": "Cash Mall"})
    store_id = r.json()["id"]
    r = await client.post("/api/v1/day-sessions/open", headers=h,
                          json={"store_id": store_id, "opening_cash": opening})
    assert r.status_code in (200, 201), r.text
    return {"h": h, "store_id": store_id, "session_id": r.json()["id"]}


async def test_the_total_is_derived_from_the_notes(client: AsyncClient) -> None:
    """Six 500s and eleven 100s is 4,100 — and the software says so rather
    than trusting whatever was typed."""
    s = await _open_till(client)

    r = await client.post(
        f"/api/v1/day-sessions/{s['session_id']}/close", headers=s["h"],
        json={"counted_cash": "4100.00", "denominations": {"500": 6, "100": 11}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert Decimal(body["counted_cash"]) == Decimal("4100.00")
    assert body["cash_denominations"] == {"500": 6, "100": 11}


async def test_notes_that_do_not_add_up_are_refused(client: AsyncClient) -> None:
    """THE BUG THIS CATCHES.

    A typed total and a note count that disagree mean one of them is wrong,
    and guessing which would be the software quietly deciding how much money
    the shop has. It refuses while the person is still standing at the till
    with the cash in their hands.
    """
    s = await _open_till(client)

    r = await client.post(
        f"/api/v1/day-sessions/{s['session_id']}/close", headers=s["h"],
        # A slipped digit: 4,100 typed as 41,000.
        json={"counted_cash": "41000.00", "denominations": {"500": 6, "100": 11}})
    assert r.status_code == 422, r.text
    err = r.json()["error"]
    assert err["code"] == "CASH_COUNT_MISMATCH"
    # And it says BY HOW MUCH, so the person knows which figure to re-check.
    assert err["details"]["notes_add_up_to"] == "4100"
    assert err["details"]["total_entered"] == "41000.00"


async def test_a_refused_close_leaves_the_till_open(client: AsyncClient) -> None:
    """A shift half-closed on a rejected cash count would be unusable: no more
    sales, and no way to correct the figure."""
    s = await _open_till(client)

    await client.post(
        f"/api/v1/day-sessions/{s['session_id']}/close", headers=s["h"],
        json={"counted_cash": "9999.00", "denominations": {"500": 1}})

    r = await client.get(
        f"/api/v1/day-sessions/current?store_id={s['store_id']}", headers=s["h"])
    assert r.status_code == 200, r.text
    assert r.json() is not None
    assert r.json()["status"] == "open"


async def test_closing_without_a_breakdown_still_works(client: AsyncClient) -> None:
    """A till that closes with a typed total behaves exactly as it always has.
    This records the breakdown when someone enters it; it never demands it."""
    s = await _open_till(client)

    r = await client.post(
        f"/api/v1/day-sessions/{s['session_id']}/close", headers=s["h"],
        json={"counted_cash": "1000.00"})
    assert r.status_code == 200, r.text
    assert r.json()["cash_denominations"] is None
    assert Decimal(r.json()["counted_cash"]) == Decimal("1000.00")


async def test_the_difference_against_expected_uses_the_counted_notes(
    client: AsyncClient,
) -> None:
    """Opened with 1,000, counted 1,500, nothing sold — 500 over."""
    s = await _open_till(client)

    r = await client.post(
        f"/api/v1/day-sessions/{s['session_id']}/close", headers=s["h"],
        json={"counted_cash": "1500.00", "denominations": {"500": 3}})
    assert r.status_code == 200, r.text
    assert Decimal(r.json()["cash_diff"]) == Decimal("500.00")


async def test_a_negative_note_count_is_refused(client: AsyncClient) -> None:
    """Not a shortage — a bug. Letting it through would silently reduce a
    drawer total somebody is later held responsible for."""
    s = await _open_till(client)

    r = await client.post(
        f"/api/v1/day-sessions/{s['session_id']}/close", headers=s["h"],
        json={"counted_cash": "500.00", "denominations": {"500": 2, "100": -5}})
    assert r.status_code == 422, r.text


async def test_denominations_of_zero_are_dropped(client: AsyncClient) -> None:
    """A count of zero carries no information, and keeping it would clutter
    every stored breakdown with the notes nobody had."""
    s = await _open_till(client)

    r = await client.post(
        f"/api/v1/day-sessions/{s['session_id']}/close", headers=s["h"],
        json={"counted_cash": "1000.00",
              "denominations": {"500": 2, "200": 0, "100": 0}})
    assert r.status_code == 200, r.text
    assert r.json()["cash_denominations"] == {"500": 2}


async def test_a_note_value_that_is_not_a_number_is_refused(
    client: AsyncClient,
) -> None:
    s = await _open_till(client)
    r = await client.post(
        f"/api/v1/day-sessions/{s['session_id']}/close", headers=s["h"],
        json={"counted_cash": "500.00", "denominations": {"five hundred": 1}})
    assert r.status_code == 422, r.text
