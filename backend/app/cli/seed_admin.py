"""Idempotent super-admin bootstrap.

Usage::

    python -m app.cli.seed_admin --email admin@retailos.local --password "Strong!Pass123" \\
        --full-name "System Admin"

If a user with the given email already exists, only the password + role are updated.
Safe to re-run.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.core.security import hash_password
from app.db.models.user import User, UserRole
from app.db.session import session_scope


async def _seed(email: str, password: str, full_name: str) -> None:
    email = email.lower().strip()
    async with session_scope() as db:
        existing = await db.scalar(select(User).where(User.email == email))
        if existing is None:
            db.add(
                User(
                    email=email,
                    full_name=full_name,
                    hashed_password=hash_password(password),
                    role=UserRole.SUPER_ADMIN,
                    is_active=True,
                )
            )
            print(f"[ok] Created SUPER_ADMIN {email}")
        else:
            existing.hashed_password = hash_password(password)
            existing.role = UserRole.SUPER_ADMIN
            existing.is_active = True
            existing.full_name = full_name
            # ASCII only: this runs on Windows consoles using cp1252, where a
            # non-ASCII character raises UnicodeEncodeError. The print sits
            # inside the session_scope block, so that crash rolled the
            # password change back instead of committing it.
            print(f"[ok] Updated existing user {email} -> SUPER_ADMIN")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Create or reset the RetailOS super admin.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True, help="Min 8 chars.")
    parser.add_argument("--full-name", default="System Admin")
    args = parser.parse_args(argv)

    if len(args.password) < 8:
        print("password must be at least 8 characters", file=sys.stderr)
        sys.exit(2)

    asyncio.run(_seed(args.email, args.password, args.full_name))


if __name__ == "__main__":
    main()
