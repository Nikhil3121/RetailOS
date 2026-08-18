"""Reusable test fixtures — seed a user, log in, get a token."""

from __future__ import annotations

from httpx import AsyncClient

from app.core.security import hash_password
from app.db.models.user import User, UserRole
from app.db.session import session_scope


async def seed_user(
    email: str = "owner@example.com",
    password: str = "test-password-1",
    role: UserRole = UserRole.OWNER,
) -> None:
    async with session_scope() as db:
        db.add(
            User(
                email=email,
                full_name=email.split("@")[0].title(),
                hashed_password=hash_password(password),
                role=role,
                is_active=True,
            )
        )


async def login(
    client: AsyncClient,
    email: str = "owner@example.com",
    password: str = "test-password-1",
) -> str:
    """Return an access token; seeds the user first."""
    await seed_user(email, password)
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["tokens"]["access_token"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
