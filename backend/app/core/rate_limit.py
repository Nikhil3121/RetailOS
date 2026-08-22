"""Shared slowapi Limiter instance.

Living in its own module so both `app.main` (which attaches it to
`app.state` and installs the middleware) and per-endpoint modules (which
decorate individual routes with `.limit("N/minute")`) reference the SAME
limiter. Two independent Limiter() instances would each use their own
storage backend, silently splitting counters — that would make a stricter
per-endpoint ceiling look enforced while allowing 2x traffic through.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import get_settings

_settings = get_settings()

# Keyed by client IP. When we deploy behind a proxy that sets
# X-Forwarded-For, the RequestContextMiddleware already normalises it, so
# `get_remote_address` reads the real client IP not the proxy.
limiter = Limiter(key_func=get_remote_address, default_limits=[_settings.rate_limit_default])
