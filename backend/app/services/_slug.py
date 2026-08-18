"""Deterministic slug generation shared by brand + category services."""

from __future__ import annotations

import re
import unicodedata

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(text: str, *, max_length: int = 160) -> str:
    """Return a lowercase, hyphen-separated slug for `text`.

    Handles unicode, collapses runs of separators, strips leading/trailing hyphens,
    and truncates to `max_length` without cutting mid-hyphen.
    """
    normalized = unicodedata.normalize("NFKD", text)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = _SLUG_RE.sub("-", ascii_only.lower()).strip("-")
    if len(slug) <= max_length:
        return slug or "item"
    cut = slug[:max_length].rstrip("-")
    return cut or slug[:max_length]
