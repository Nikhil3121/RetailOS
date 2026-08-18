"""Smoke tests for every Phase 2 module.

Not exhaustive — one happy-path call per major endpoint group. If any of these
break the whole module is likely broken; if they all pass the surface is at
least reachable + validated.
"""

from __future__ import annotations

from datetime import date

from httpx import AsyncClient

from tests._helpers import auth, login


# ---------------------------------------------------------------------------
# Set-up: create a store + supplier + unit + product so downstream tests have
# something real to reference.
# ---------------------------------------------------------------------------


async def _bootstrap(client: AsyncClient) -> dict[str, str]:
    token = await login(client)
    h = auth(token)

    r = await client.post("/api/v1/stores", headers=h, json={
        "code": "S1", "name": "Test Store",
    })
    assert r.status_code == 201, r.text
    store_id = r.json()["id"]

    r = await client.post("/api/v1/units", headers=h, json={
        "name": "Piece", "symbol": "pc", "is_fractional": False,
    })
    assert r.status_code == 201, r.text
    unit_id = r.json()["id"]

    r = await client.post("/api/v1/suppliers", headers=h, json={
        "code": "SUP1", "name": "Test Supplier",
    })
    assert r.status_code == 201, r.text
    supplier_id = r.json()["id"]

    r = await client.post("/api/v1/products", headers=h, json={
        "name": "Widget", "unit_id": unit_id,
        "tax_rate": "5.00", "hsn_code": "1234",
        "variants": [{
            "name": "Default", "sku": "WDG-1",
            "cost_price": "50.00", "mrp": "100.00", "selling_price": "80.00",
            "reorder_point": "3.000", "reorder_quantity": "10.000",
        }],
    })
    assert r.status_code == 201, r.text
    product = r.json()
    variant_id = product["variants"][0]["id"]

    return {
        "token": token,
        "store_id": store_id,
        "unit_id": unit_id,
        "supplier_id": supplier_id,
        "product_id": product["id"],
        "variant_id": variant_id,
    }


# ---------------------------------------------------------------------------
# Phase 1 recap — POS + inventory happy path
# ---------------------------------------------------------------------------


async def test_full_pos_flow(client: AsyncClient) -> None:
    ctx = await _bootstrap(client)
    h = auth(ctx["token"])

    # Open day session.
    r = await client.post("/api/v1/day-sessions/open", headers=h, json={
        "store_id": ctx["store_id"], "opening_cash": "1000.00",
    })
    assert r.status_code == 201, r.text

    # Adjust stock so we have inventory to sell.
    r = await client.post("/api/v1/inventory/adjust", headers=h, json={
        "store_id": ctx["store_id"],
        "reason": "OPENING BALANCE",
        "lines": [{"variant_id": ctx["variant_id"], "delta": "10.000"}],
    })
    assert r.status_code == 201, r.text

    # Ring up a sale.
    r = await client.post("/api/v1/sales", headers=h, json={
        "store_id": ctx["store_id"],
        "lines": [{"variant_id": ctx["variant_id"], "quantity": "2.000"}],
        "payments": [{"method": "cash", "amount": "168.00"}],
    })
    assert r.status_code == 201, r.text
    sale = r.json()
    assert sale["status"] == "completed"
    assert len(sale["lines"]) == 1

    # Stock is now 8.
    r = await client.get(f"/api/v1/inventory/levels?store_id={ctx['store_id']}", headers=h)
    assert r.status_code == 200
    rows = r.json()["items"]
    assert any(row["variant_id"] == ctx["variant_id"] and row["quantity"] == "8.000" for row in rows)


# ---------------------------------------------------------------------------
# Phase 2 · M1 — Dashboard
# ---------------------------------------------------------------------------


async def test_dashboard_payload(client: AsyncClient) -> None:
    ctx = await _bootstrap(client)
    h = auth(ctx["token"])
    r = await client.get("/api/v1/dashboard?period=today", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "kpis" in body
    assert "hourly" in body
    assert "daily_trend" in body
    assert "payment_mix" in body


# ---------------------------------------------------------------------------
# Phase 2 · M2 — Commission + staff performance
# ---------------------------------------------------------------------------


async def test_commission_rule_and_calc(client: AsyncClient) -> None:
    ctx = await _bootstrap(client)
    h = auth(ctx["token"])

    r = await client.post("/api/v1/commissions/rules", headers=h, json={
        "name": "Flat 5%", "scope": "global",
        "commission_type": "percentage", "rate": "5.00",
    })
    assert r.status_code == 201, r.text

    today = date.today().isoformat()
    r = await client.get(
        f"/api/v1/commissions/calculate?from_date={today}&to_date={today}",
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert "per_staff" in r.json()

    r = await client.get(
        f"/api/v1/staff/performance?from_date={today}&to_date={today}",
        headers=h,
    )
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Coupons
# ---------------------------------------------------------------------------


async def test_coupon_create_and_validate(client: AsyncClient) -> None:
    ctx = await _bootstrap(client)
    h = auth(ctx["token"])

    r = await client.post("/api/v1/coupons", headers=h, json={
        "code": "WELCOME10", "name": "Welcome",
        "discount_type": "percentage", "discount_value": "10.00",
        "min_bill_amount": "100.00",
    })
    assert r.status_code == 201, r.text

    r = await client.post("/api/v1/coupons/validate", headers=h, json={
        "code": "WELCOME10", "bill_amount": "500.00",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["valid"] is True
    assert body["computed_discount"] == "50.00"


# ---------------------------------------------------------------------------
# Phase 2 · M4 — Inventory intelligence + purchase analytics
# ---------------------------------------------------------------------------


async def test_inventory_intelligence(client: AsyncClient) -> None:
    ctx = await _bootstrap(client)
    h = auth(ctx["token"])

    r = await client.get("/api/v1/inventory/intelligence/summary", headers=h)
    assert r.status_code == 200, r.text

    r = await client.get("/api/v1/inventory/intelligence/alerts", headers=h)
    assert r.status_code == 200

    r = await client.get("/api/v1/inventory/intelligence/value", headers=h)
    assert r.status_code == 200


async def test_purchase_analytics(client: AsyncClient) -> None:
    ctx = await _bootstrap(client)
    h = auth(ctx["token"])

    r = await client.get("/api/v1/purchase-analytics/summary", headers=h)
    assert r.status_code == 200, r.text

    r = await client.get("/api/v1/purchase-analytics/suppliers", headers=h)
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# Phase 2 · M5 — Expenses + P&L
# ---------------------------------------------------------------------------


async def test_expense_workflow(client: AsyncClient) -> None:
    ctx = await _bootstrap(client)
    h = auth(ctx["token"])

    # Category.
    r = await client.post("/api/v1/expenses/categories", headers=h, json={
        "code": "RENT", "name": "Rent",
    })
    assert r.status_code == 201, r.text
    cat_id = r.json()["id"]

    # Create + submit in one.
    r = await client.post("/api/v1/expenses", headers=h, json={
        "category_id": cat_id,
        "expense_date": date.today().isoformat(),
        "amount": "5000.00",
        "submit": True,
    })
    assert r.status_code == 201, r.text
    exp = r.json()
    assert exp["status"] == "submitted"

    # Approve.
    r = await client.post(f"/api/v1/expenses/{exp['id']}/approve", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"

    # P&L should include it.
    today = date.today().isoformat()
    r = await client.get(
        f"/api/v1/expenses/reports/pnl?from_date={today}&to_date={today}",
        headers=h,
    )
    assert r.status_code == 200, r.text
    pnl = r.json()
    assert float(pnl["operating_expenses"]) >= 5000.00


# ---------------------------------------------------------------------------
# Phase 2 · M6 — Notifications
# ---------------------------------------------------------------------------


async def test_notifications(client: AsyncClient) -> None:
    ctx = await _bootstrap(client)
    h = auth(ctx["token"])

    # Publish one ad-hoc.
    r = await client.post("/api/v1/notifications", headers=h, json={
        "title": "Hello", "body": "Test message",
        "severity": "info", "channels": ["in_app"],
    })
    assert r.status_code == 201, r.text

    # List.
    r = await client.get("/api/v1/notifications", headers=h)
    assert r.status_code == 200
    assert r.json()["total"] >= 1

    # Unread count.
    r = await client.get("/api/v1/notifications/unread-count", headers=h)
    assert r.status_code == 200
    assert r.json()["unread"] >= 1


# ---------------------------------------------------------------------------
# Phase 2 · M7 — Audit + dashboard layout
# ---------------------------------------------------------------------------


async def test_audit_log(client: AsyncClient) -> None:
    ctx = await _bootstrap(client)
    h = auth(ctx["token"])
    # The login itself + user creates from _bootstrap should have written entries.
    r = await client.get("/api/v1/audit-logs", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    actions = {row["action"] for row in body["items"]}
    assert "user.login" in actions


async def test_dashboard_layout_roundtrip(client: AsyncClient) -> None:
    ctx = await _bootstrap(client)
    h = auth(ctx["token"])

    r = await client.put("/api/v1/dashboard-layout", headers=h, json={
        "layout": {"hidden": ["profit-note"], "order": ["kpi-row-1", "kpi-row-2"]},
    })
    assert r.status_code == 200, r.text

    r = await client.get("/api/v1/dashboard-layout", headers=h)
    assert r.status_code == 200
    assert r.json()["layout"]["hidden"] == ["profit-note"]
