"""Unit-of-measure CRUD."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.db.models.unit import Unit
from app.schemas.unit import UnitCreate, UnitUpdate


class UnitService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, payload: UnitCreate) -> Unit:
        clash = await self.db.scalar(select(Unit).where(Unit.symbol == payload.symbol))
        if clash is not None:
            raise ConflictError("A unit with this symbol already exists.", code="UNIT_SYMBOL_TAKEN")
        unit = Unit(**payload.model_dump())
        self.db.add(unit)
        await self.db.flush()
        return unit

    async def get(self, unit_id: uuid.UUID) -> Unit:
        unit = await self.db.get(Unit, unit_id)
        if unit is None:
            raise NotFoundError("Unit not found.", code="UNIT_NOT_FOUND")
        return unit

    async def list(self, *, page: int = 1, page_size: int = 100) -> tuple[list[Unit], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 500)
        total = await self.db.scalar(select(func.count()).select_from(Unit)) or 0
        rows = (
            await self.db.scalars(
                select(Unit)
                .order_by(Unit.name)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    async def update(self, unit_id: uuid.UUID, payload: UnitUpdate) -> Unit:
        unit = await self.get(unit_id)
        data = payload.model_dump(exclude_unset=True)
        if "symbol" in data and data["symbol"] != unit.symbol:
            clash = await self.db.scalar(select(Unit).where(Unit.symbol == data["symbol"]))
            if clash is not None:
                raise ConflictError("Symbol already in use.", code="UNIT_SYMBOL_TAKEN")
        for field, value in data.items():
            setattr(unit, field, value)
        await self.db.flush()
        return unit

    async def delete(self, unit_id: uuid.UUID) -> None:
        unit = await self.get(unit_id)
        await self.db.delete(unit)
        await self.db.flush()
