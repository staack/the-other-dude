"""Request/response schemas for Remote WinBox (Browser) sessions."""

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class RemoteWinboxState(str, Enum):
    creating = "creating"
    active = "active"
    grace = "grace"
    terminating = "terminating"
    terminated = "terminated"
    failed = "failed"


class RemoteWinboxCreateRequest(BaseModel):
    idle_timeout_seconds: int = Field(default=600, ge=60, le=3600)
    max_lifetime_seconds: int = Field(default=7200, ge=300, le=14400)


class RemoteWinboxSessionResponse(BaseModel):
    session_id: uuid.UUID
    status: RemoteWinboxState = RemoteWinboxState.active
    websocket_path: str
    expires_at: datetime
    max_expires_at: datetime
    idle_timeout_seconds: int
    max_lifetime_seconds: int
    xpra_ws_port: Optional[int] = None


class RemoteWinboxStatusResponse(BaseModel):
    session_id: uuid.UUID
    status: RemoteWinboxState
    created_at: datetime
    expires_at: datetime
    max_expires_at: datetime
    idle_timeout_seconds: int
    max_lifetime_seconds: int
    xpra_ws_port: Optional[int] = None


class RemoteWinboxTerminateResponse(BaseModel):
    session_id: uuid.UUID
    status: RemoteWinboxState
    reason: str


class RemoteWinboxDuplicateDetail(BaseModel):
    detail: str = "Active session exists"
    session: RemoteWinboxStatusResponse


class RemoteWinboxSessionItem(BaseModel):
    """Used in the combined active sessions list."""

    session_id: uuid.UUID
    status: RemoteWinboxState
    created_at: datetime
    expires_at: datetime
