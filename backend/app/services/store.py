"""Store CRUD service."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.db.models.store import Store
from app.schemas.store import StoreCreate, StoreUpdate


class StoreService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, payload: StoreCreate) -> Store:
        clash = await self.db.scalar(select(Store).where(Store.code == payload.code))
        if clash is not None:
            raise ConflictError("A store with this code already exists.", code="STORE_CODE_TAKEN")
        store = Store(**payload.model_dump())
        self.db.add(store)
        await self.db.flush()
        return store

    async def get(self, store_id: uuid.UUID) -> Store:
        store = await self.db.get(Store, store_id)
        if store is None:
            raise NotFoundError("Store not found.", code="STORE_NOT_FOUND")
        return store

    async def list(self, *, page: int = 1, page_size: int = 50) -> tuple[list[Store], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 1000)
        total = await self.db.scalar(select(func.count()).select_from(Store)) or 0
        rows = (
            await self.db.scalars(
                select(Store)
                .order_by(Store.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    async def update(self, store_id: uuid.UUID, payload: StoreUpdate) -> Store:
        store = await self.get(store_id)
        data = payload.model_dump(exclude_unset=True)
        for field, value in data.items():
            setattr(store, field, value)
        await self.db.flush()
        return store

    async def delete(self, store_id: uuid.UUID) -> None:
        store = await self.get(store_id)
        await self.db.delete(store)
        await self.db.flush()
