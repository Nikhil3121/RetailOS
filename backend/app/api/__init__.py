"""HTTP transport layer.

The API layer owns request/response serialisation only. It calls into `app.services`
for orchestration and never touches `app.db` directly. This boundary is what keeps
the domain testable without a running server.
"""
