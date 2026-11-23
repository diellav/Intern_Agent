"""Shared request dependencies.

Routes call `deps.program_connection(...)` through this module, so tests can swap the
connection in one place.
"""
from typing import Annotated
from uuid import UUID

from fastapi import Depends

from app.main import actor_id, program_connection  # noqa: F401  (re-exported)

Actor = Annotated[UUID, Depends(actor_id)]
