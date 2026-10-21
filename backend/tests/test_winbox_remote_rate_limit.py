"""Per-user Remote WinBox throttling and actionable retry responses."""

import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.routers import winbox_remote


async def test_allowed_attempt_uses_atomic_counter_with_short_window(monkeypatch):
    rd = AsyncMock()
    rd.eval.return_value = [1, 0]
    monkeypatch.setattr(winbox_remote, "_get_redis", AsyncMock(return_value=rd))
    user = uuid.uuid4()

    await winbox_remote._check_rate_limit(user)

    rd.eval.assert_awaited_once_with(
        winbox_remote._SESSION_RATE_SCRIPT, 1, f"winbox-remote-rate:v2:{user}", 10, 60
    )


@pytest.mark.parametrize("ttl,wait", [(42, 42), (1, 1), (0, 1)])
async def test_limited_attempt_includes_remaining_wait(monkeypatch, ttl, wait):
    rd = AsyncMock()
    rd.eval.return_value = [0, ttl]
    monkeypatch.setattr(winbox_remote, "_get_redis", AsyncMock(return_value=rd))

    with pytest.raises(HTTPException) as exc:
        await winbox_remote._check_rate_limit(uuid.uuid4())

    assert exc.value.status_code == 429
    assert exc.value.headers == {"Retry-After": str(wait)}
    assert exc.value.detail == (
        f"Too many Remote WinBox session requests. Try again in {wait} seconds."
    )
