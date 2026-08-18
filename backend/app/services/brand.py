"""Brand CRUD."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.db.models.brand import Brand
from app.schemas.brand import BrandCreate, BrandUpdate
from app.services._slug import slugify


class BrandService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, payload: BrandCreate) -> Brand:
        slug = (payload.slug or slugify(payload.name)).lower()
        await self._assert_slug_free(slug)
        brand = Brand(
            name=payload.name,
            slug=slug,
            description=payload.description,
            logo_url=str(payload.logo_url) if payload.logo_url else None,
            is_active=payload.is_active,
        )
        self.db.add(brand)
        await self.db.flush()
        return brand

    async def get(self, brand_id: uuid.UUID) -> Brand:
        brand = await self.db.get(Brand, brand_id)
        if brand is None:
            raise NotFoundError("Brand not found.", code="BRAND_NOT_FOUND")
        return brand

    async def list(self, *, page: int = 1, page_size: int = 100) -> tuple[list[Brand], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 500)
        total = await self.db.scalar(select(func.count()).select_from(Brand)) or 0
        rows = (
            await self.db.scalars(
                select(Brand)
                .order_by(Brand.name)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    async def update(self, brand_id: uuid.UUID, payload: BrandUpdate) -> Brand:
        brand = await self.get(brand_id)
        data = payload.model_dump(exclude_unset=True)
        if "slug" in data and data["slug"] and data["slug"] != brand.slug:
            new_slug = data["slug"].lower()
            await self._assert_slug_free(new_slug, ignoring=brand.id)
            data["slug"] = new_slug
        if "logo_url" in data and data["logo_url"] is not None:
            data["logo_url"] = str(data["logo_url"])
        for field, value in data.items():
            setattr(brand, field, value)
        await self.db.flush()
        return brand

    async def delete(self, brand_id: uuid.UUID) -> None:
        brand = await self.get(brand_id)
        await self.db.delete(brand)
        await self.db.flush()

    async def _assert_slug_free(self, slug: str, *, ignoring: uuid.UUID | None = None) -> None:
        stmt = select(Brand).where(Brand.slug == slug)
        existing = await self.db.scalar(stmt)
        if existing and existing.id != ignoring:
            raise ConflictError("A brand with this slug already exists.", code="BRAND_SLUG_TAKEN")
