"""Cross-cutting infrastructure: configuration, logging, security primitives, exceptions.

Nothing in `app.core` may import from `app.api`, `app.services`, or `app.db.models`.
This is the innermost layer and must stay dependency-free relative to business logic.
"""
