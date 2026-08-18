"""Supplier CRUD."""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.db.models.supplier import Supplier
from app.schemas.supplier import SupplierCreate, SupplierUpdate


class SupplierService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, payload: SupplierCreate) -> Supplier:
        clash = await self.db.scalar(select(Supplier).where(Supplier.code == payload.code))
        if clash is not None:
            raise ConflictError("A supplier with this code already exists.", code="SUPPLIER_CODE_TAKEN")
        supplier = Supplier(**payload.model_dump())
        self.db.add(supplier)
        await self.db.flush()
        return supplier

    async def get(self, supplier_id: uuid.UUID) -> Supplier:
        supplier = await self.db.get(Supplier, supplier_id)
        if supplier is None:
            raise NotFoundError("Supplier not found.", code="SUPPLIER_NOT_FOUND")
        return supplier

    async def list(
        self,
        *,
        page: int = 1,
        page_size: int = 50,
        search: str | None = None,
    ) -> tuple[list[Supplier], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 1000)

        base = select(Supplier)
        if search:
            like = f"%{search.strip()}%"
            base = base.where(or_(Supplier.name.ilike(like), Supplier.code.ilike(like)))

        total = await self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = (
            await self.db.scalars(
                base.order_by(Supplier.name)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    async def update(self, supplier_id: uuid.UUID, payload: SupplierUpdate) -> Supplier:
        supplier = await self.get(supplier_id)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(supplier, field, value)
        await self.db.flush()
        return supplier

    async def delete(self, supplier_id: uuid.UUID) -> None:
        supplier = await self.get(supplier_id)
        await self.db.delete(supplier)
        await self.db.flush()
