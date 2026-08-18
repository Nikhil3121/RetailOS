"""User CRUD service — used by admin endpoints. Enforces uniqueness and rehashes
passwords with the current argon2 policy at write time."""

from __future__ import annotations

import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.core.security import hash_password
from app.db.models.user import User
from app.schemas.user import UserCreate, UserUpdate


_STAFF_CODE_PATTERN = re.compile(r"^STF-(\d+)$")


class UserService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _next_staff_code(self) -> str:
        """Generate the next STF-#### code by scanning the highest existing one."""
        rows = await self.db.scalars(
            select(User.staff_code).where(User.staff_code.is_not(None))
        )
        highest = 0
        for code in rows:
            m = _STAFF_CODE_PATTERN.match(str(code or "").strip().upper())
            if m:
                highest = max(highest, int(m.group(1)))
        return f"STF-{highest + 1:04d}"

    async def create(self, payload: UserCreate) -> User:
        existing = await self.db.scalar(
            select(User).where(User.email == payload.email.lower())
        )
        if existing is not None:
            raise ConflictError("A user with this email already exists.", code="USER_EMAIL_TAKEN")

        # Auto-assign a staff code when the caller doesn't supply one. If they
        # do supply one, honour it but reject collisions.
        staff_code = (payload.staff_code or "").strip().upper() or None
        if staff_code:
            clash = await self.db.scalar(
                select(User).where(User.staff_code == staff_code)
            )
            if clash is not None:
                raise ConflictError(
                    "That staff code is already in use.",
                    code="STAFF_CODE_TAKEN",
                )
        else:
            staff_code = await self._next_staff_code()

        user = User(
            email=payload.email.lower(),
            full_name=payload.full_name,
            hashed_password=hash_password(payload.password),
            role=payload.role,
            store_id=payload.store_id,
            is_active=payload.is_active,
            phone=(payload.phone or None),
            staff_code=staff_code,
            commission_pct=payload.commission_pct,
        )
        self.db.add(user)
        await self.db.flush()
        return user

    async def get_by_staff_code(self, staff_code: str) -> User | None:
        code = staff_code.strip().upper()
        if not code:
            return None
        return await self.db.scalar(select(User).where(User.staff_code == code))

    async def get(self, user_id: uuid.UUID) -> User:
        user = await self.db.get(User, user_id)
        if user is None:
            raise NotFoundError("User not found.", code="USER_NOT_FOUND")
        return user

    async def list(self, *, page: int = 1, page_size: int = 50) -> tuple[list[User], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 1000)
        total = await self.db.scalar(select(func.count()).select_from(User)) or 0
        rows = (
            await self.db.scalars(
                select(User)
                .order_by(User.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    async def update(self, user_id: uuid.UUID, payload: UserUpdate) -> User:
        user = await self.get(user_id)
        data = payload.model_dump(exclude_unset=True)

        # Uppercase-normalise + collision-check any incoming staff_code change.
        if "staff_code" in data and data["staff_code"]:
            code = str(data["staff_code"]).strip().upper()
            if code:
                clash = await self.db.scalar(
                    select(User).where(
                        User.staff_code == code, User.id != user_id
                    )
                )
                if clash is not None:
                    raise ConflictError(
                        "That staff code is already in use.",
                        code="STAFF_CODE_TAKEN",
                    )
                data["staff_code"] = code

        for field, value in data.items():
            setattr(user, field, value)
        await self.db.flush()
        return user

    async def delete(self, user_id: uuid.UUID) -> None:
        user = await self.get(user_id)
        await self.db.delete(user)
        await self.db.flush()
