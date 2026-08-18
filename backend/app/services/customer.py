"""Customer CRUD."""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.db.models.customer import Customer
from app.schemas.customer import CustomerCreate, CustomerUpdate


class CustomerService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, payload: CustomerCreate) -> Customer:
        if payload.phone:
            clash = await self.db.scalar(select(Customer).where(Customer.phone == payload.phone))
            if clash is not None:
                raise ConflictError(
                    "A customer with this phone already exists.", code="CUSTOMER_PHONE_TAKEN"
                )
        customer = Customer(**payload.model_dump())
        self.db.add(customer)
        await self.db.flush()
        return customer

    async def get(self, customer_id: uuid.UUID) -> Customer:
        customer = await self.db.get(Customer, customer_id)
        if customer is None:
            raise NotFoundError("Customer not found.", code="CUSTOMER_NOT_FOUND")
        return customer

    async def list(
        self,
        *,
        page: int = 1,
        page_size: int = 50,
        search: str | None = None,
    ) -> tuple[list[Customer], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 1000)

        base = select(Customer)
        if search:
            like = f"%{search.strip()}%"
            base = base.where(
                or_(
                    Customer.name.ilike(like),
                    Customer.phone.ilike(like),
                    Customer.email.ilike(like),
                )
            )

        total = await self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = (
            await self.db.scalars(
                base.order_by(Customer.name)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    async def update(self, customer_id: uuid.UUID, payload: CustomerUpdate) -> Customer:
        customer = await self.get(customer_id)
        data = payload.model_dump(exclude_unset=True)

        if "phone" in data and data["phone"] and data["phone"] != customer.phone:
            clash = await self.db.scalar(select(Customer).where(Customer.phone == data["phone"]))
            if clash and clash.id != customer.id:
                raise ConflictError(
                    "A customer with this phone already exists.", code="CUSTOMER_PHONE_TAKEN"
                )

        for field, value in data.items():
            setattr(customer, field, value)
        await self.db.flush()
        return customer

    async def delete(self, customer_id: uuid.UUID) -> None:
        customer = await self.get(customer_id)
        await self.db.delete(customer)
        await self.db.flush()
