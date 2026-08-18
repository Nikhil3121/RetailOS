"""Category DTOs. `CategoryTreeNode` is the recursive shape used by /categories/tree."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class CategoryBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    slug: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=1024)
    parent_id: uuid.UUID | None = None
    sort_order: int = 0
    is_active: bool = True


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    slug: str | None = Field(default=None, max_length=160)
    description: str | None = None
    parent_id: uuid.UUID | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class CategoryRead(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str | None
    parent_id: uuid.UUID | None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CategoryTreeNode(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    sort_order: int
    is_active: bool
    children: list["CategoryTreeNode"] = Field(default_factory=list)


CategoryTreeNode.model_rebuild()
