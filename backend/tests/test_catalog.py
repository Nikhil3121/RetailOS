"""Catalog end-to-end tests. Covers the create-with-variants round-trip, tree
building, and the sharpest failure edges (duplicate SKU, deleting the last variant).
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.security import hash_password
from app.db.models.user import User, UserRole
from app.db.session import session_scope


async def _authed(client: AsyncClient) -> str:
    async with session_scope() as db:
        db.add(
            User(
                email="owner@example.com",
                full_name="Owner",
                hashed_password=hash_password("owner-password-1"),
                role=UserRole.OWNER,
                is_active=True,
            )
        )
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "owner-password-1"},
    )
    assert r.status_code == 200
    return r.json()["tokens"]["access_token"]


async def _create_unit(client: AsyncClient, token: str, symbol: str = "pc") -> str:
    r = await client.post(
        "/api/v1/units",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Piece", "symbol": symbol, "is_fractional": False, "is_active": True},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_create_product_with_variants(client: AsyncClient) -> None:
    token = await _authed(client)
    unit_id = await _create_unit(client, token)

    r = await client.post(
        "/api/v1/products",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Cotton T-Shirt",
            "hsn_code": "6109",
            "tax_rate": "5.00",
            "unit_id": unit_id,
            "variants": [
                {"name": "Small · Black", "sku": "TS-BLK-S", "barcode": "890000001",
                 "attributes": {"size": "S", "color": "Black"},
                 "cost_price": "150.00", "mrp": "499.00", "selling_price": "399.00"},
                {"name": "Medium · Black", "sku": "TS-BLK-M", "barcode": "890000002",
                 "attributes": {"size": "M", "color": "Black"},
                 "cost_price": "150.00", "mrp": "499.00", "selling_price": "399.00"},
            ],
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert len(body["variants"]) == 2
    assert body["hsn_code"] == "6109"


async def test_duplicate_sku_rejected(client: AsyncClient) -> None:
    token = await _authed(client)
    unit_id = await _create_unit(client, token)

    payload = {
        "name": "Widget",
        "unit_id": unit_id,
        "variants": [
            {"name": "Default", "sku": "WID-01"},
            {"name": "Second", "sku": "WID-01"},  # duplicate within the payload
        ],
    }
    r = await client.post(
        "/api/v1/products",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "VARIANT_SKU_DUPLICATE"


async def test_cannot_delete_last_variant(client: AsyncClient) -> None:
    token = await _authed(client)
    unit_id = await _create_unit(client, token)

    r = await client.post(
        "/api/v1/products",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Solo",
            "unit_id": unit_id,
            "variants": [{"name": "Only", "sku": "SOLO-1"}],
        },
    )
    variant_id = r.json()["variants"][0]["id"]

    r = await client.delete(
        f"/api/v1/products/variants/{variant_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "LAST_VARIANT"


async def test_category_tree(client: AsyncClient) -> None:
    token = await _authed(client)

    async def make(name: str, parent_id: str | None = None) -> str:
        r = await client.post(
            "/api/v1/categories",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": name, "parent_id": parent_id},
        )
        assert r.status_code == 201, r.text
        return r.json()["id"]

    root = await make("Apparel")
    child = await make("Shirts", parent_id=root)
    await make("Casual", parent_id=child)
    await make("Grocery")  # second root

    r = await client.get(
        "/api/v1/categories/tree",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    tree = r.json()
    assert {node["name"] for node in tree} == {"Apparel", "Grocery"}
    apparel = next(n for n in tree if n["name"] == "Apparel")
    assert apparel["children"][0]["name"] == "Shirts"
    assert apparel["children"][0]["children"][0]["name"] == "Casual"
