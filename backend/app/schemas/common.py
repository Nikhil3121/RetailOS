"""Shared schema primitives used by every feature module."""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ORMModel(BaseModel):
    """Base for schemas that read from ORM objects (`from_attributes=True`)."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class Page(BaseModel, Generic[T]):
    """Standard paginated response envelope used by list endpoints."""

    items: list[T]
    total: int = Field(ge=0, description="Total records matching the filter (across all pages)")
    page: int = Field(ge=1, description="1-indexed current page")
    page_size: int = Field(ge=1, le=1000, description="Number of items per page")
