"""Pydantic schemas — the wire format of every API endpoint.

Schemas are DTOs, not ORM models. They never inherit from SQLAlchemy classes, and
services do not accept ORM models across their public boundary. This keeps the HTTP
contract stable while the persistence layer is free to evolve.
"""
