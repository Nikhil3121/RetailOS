"""Application services — orchestration between the API layer and the persistence layer.

Every use case (create user, ring up a sale, close a day) becomes a coroutine on a
service class. Services accept plain data (Pydantic DTOs, primitives) and return the
same. They never accept `Request` objects and never render HTTP responses.
"""
