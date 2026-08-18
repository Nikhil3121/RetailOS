"""End-to-end auth tests.

These exercise the real router + service + JWT stack against an in-memory SQLite
so they run without Docker. The `client` fixture in conftest points the app at
an isolated engine and applies the identity migration before each test.
"""

from __future__ import annotations

from httpx import AsyncClient


async def test_login_refresh_me_change_logout(client: AsyncClient) -> None:
    # -- create an admin via the seed helper (indirectly) ------------------
    from app.core.security import hash_password
    from app.db.models.user import User, UserRole
    from app.db.session import session_scope

    async with session_scope() as db:
        db.add(
            User(
                email="admin@example.com",
                full_name="Admin",
                hashed_password=hash_password("initial-password-9"),
                role=UserRole.SUPER_ADMIN,
                is_active=True,
            )
        )

    # -- login -------------------------------------------------------------
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "initial-password-9"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    access = body["tokens"]["access_token"]
    refresh = body["tokens"]["refresh_token"]
    assert body["user"]["role"] == "super_admin"

    # -- /me ---------------------------------------------------------------
    r = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert r.status_code == 200
    assert r.json()["email"] == "admin@example.com"

    # -- refresh -----------------------------------------------------------
    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert r.status_code == 200
    new_refresh = r.json()["refresh_token"]
    assert new_refresh != refresh

    # -- old refresh no longer works (rotation) ----------------------------
    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert r.status_code == 401

    # -- change password (revokes sessions) --------------------------------
    r = await client.post(
        "/api/v1/auth/change-password",
        headers={"Authorization": f"Bearer {access}"},
        json={"current_password": "initial-password-9", "new_password": "new-password-42"},
    )
    assert r.status_code == 204

    # -- refresh with new token should fail because change_password revoked all
    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": new_refresh})
    assert r.status_code == 401


async def test_login_wrong_password_returns_401(client: AsyncClient) -> None:
    from app.core.security import hash_password
    from app.db.models.user import User, UserRole
    from app.db.session import session_scope

    async with session_scope() as db:
        db.add(
            User(
                email="cashier@example.com",
                full_name="Cashier",
                hashed_password=hash_password("correct-horse-battery"),
                role=UserRole.CASHIER,
                is_active=True,
            )
        )

    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "cashier@example.com", "password": "wrong"},
    )
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "INVALID_CREDENTIALS"


async def test_missing_bearer_returns_401(client: AsyncClient) -> None:
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 401
