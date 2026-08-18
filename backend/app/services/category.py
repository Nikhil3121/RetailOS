"""Category CRUD + tree materialisation.

`tree()` reads the flat table once and assembles the nested structure in Python.
For catalogs of up to a few thousand categories this is faster than a recursive
CTE and considerably simpler. If the count ever crosses ~10k rows we swap in a
CTE — the endpoint contract stays the same.
"""

from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.db.models.category import Category
from app.schemas.category import CategoryCreate, CategoryTreeNode, CategoryUpdate
from app.services._slug import slugify


class CategoryService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, payload: CategoryCreate) -> Category:
        slug = (payload.slug or slugify(payload.name)).lower()
        await self._assert_slug_free(slug)
        if payload.parent_id is not None:
            await self.get(payload.parent_id)  # validate parent exists
        cat = Category(
            name=payload.name,
            slug=slug,
            description=payload.description,
            parent_id=payload.parent_id,
            sort_order=payload.sort_order,
            is_active=payload.is_active,
        )
        self.db.add(cat)
        await self.db.flush()
        return cat

    async def get(self, cat_id: uuid.UUID) -> Category:
        cat = await self.db.get(Category, cat_id)
        if cat is None:
            raise NotFoundError("Category not found.", code="CATEGORY_NOT_FOUND")
        return cat

    async def list(self, *, page: int = 1, page_size: int = 1000) -> tuple[list[Category], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 500)
        total = await self.db.scalar(select(func.count()).select_from(Category)) or 0
        rows = (
            await self.db.scalars(
                select(Category)
                .order_by(Category.sort_order, Category.name)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    async def update(self, cat_id: uuid.UUID, payload: CategoryUpdate) -> Category:
        cat = await self.get(cat_id)
        data = payload.model_dump(exclude_unset=True)
        if "parent_id" in data and data["parent_id"] is not None:
            if data["parent_id"] == cat.id:
                raise ValidationError("A category cannot be its own parent.")
            await self._assert_not_cyclic(cat.id, data["parent_id"])
        if "slug" in data and data["slug"] and data["slug"] != cat.slug:
            new_slug = data["slug"].lower()
            await self._assert_slug_free(new_slug, ignoring=cat.id)
            data["slug"] = new_slug
        for field, value in data.items():
            setattr(cat, field, value)
        await self.db.flush()
        return cat

    async def delete(self, cat_id: uuid.UUID) -> None:
        cat = await self.get(cat_id)
        await self.db.delete(cat)
        await self.db.flush()

    async def tree(self) -> list[CategoryTreeNode]:
        rows = (
            await self.db.scalars(
                select(Category).order_by(Category.sort_order, Category.name)
            )
        ).all()

        children_by_parent: dict[uuid.UUID | None, list[Category]] = defaultdict(list)
        for row in rows:
            children_by_parent[row.parent_id].append(row)

        def build(node: Category) -> CategoryTreeNode:
            return CategoryTreeNode(
                id=node.id,
                name=node.name,
                slug=node.slug,
                sort_order=node.sort_order,
                is_active=node.is_active,
                children=[build(c) for c in children_by_parent.get(node.id, [])],
            )

        return [build(root) for root in children_by_parent.get(None, [])]

    # -- internals --------------------------------------------------------
    async def _assert_slug_free(self, slug: str, *, ignoring: uuid.UUID | None = None) -> None:
        stmt = select(Category).where(Category.slug == slug)
        existing = await self.db.scalar(stmt)
        if existing and existing.id != ignoring:
            raise ConflictError("A category with this slug already exists.", code="CATEGORY_SLUG_TAKEN")

    async def _assert_not_cyclic(self, cat_id: uuid.UUID, new_parent_id: uuid.UUID) -> None:
        """Walk up from `new_parent_id`; if we hit `cat_id`, the edit would create a cycle."""
        current: uuid.UUID | None = new_parent_id
        for _ in range(64):  # depth cap; catalogs never nest this deep
            if current is None:
                return
            if current == cat_id:
                raise ValidationError(
                    "That parent would make the category a descendant of itself.",
                    code="CATEGORY_CYCLE",
                )
            row = await self.db.scalar(select(Category.parent_id).where(Category.id == current))
            current = row
        raise ValidationError("Category tree too deep.", code="CATEGORY_TOO_DEEP")
