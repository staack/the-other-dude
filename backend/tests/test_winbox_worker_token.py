"""The API must present the worker's shared secret, and the WebSocket proxy
must carry the browser's subprotocol through to xpra."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import settings
from app.routers.winbox_remote import _requested_subprotocols
from app.services import winbox_remote


def _fake_client(status_code: int, payload: dict):
    """An httpx.AsyncClient stand-in that records its constructor kwargs."""
    resp = MagicMock(status_code=status_code)
    resp.json.return_value = payload
    client = MagicMock()
    client.post = AsyncMock(return_value=resp)
    client.get = AsyncMock(return_value=resp)
    client.delete = AsyncMock(return_value=resp)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    factory = MagicMock(return_value=client)
    return factory, client


@pytest.mark.asyncio
async def test_create_session_sends_shared_secret(monkeypatch):
    monkeypatch.setattr(settings, "WINBOX_WORKER_TOKEN", "unit-test-token")
    factory, _ = _fake_client(
        201, {"worker_session_id": "s", "status": "active", "xpra_ws_port": 10100}
    )

    with patch.object(winbox_remote.httpx, "AsyncClient", factory):
        await winbox_remote.create_session("s", "tod_poller", 49001, "u", "p", 600, 7200)

    headers = factory.call_args.kwargs["headers"]
    assert headers["X-Worker-Token"] == "unit-test-token"


@pytest.mark.asyncio
async def test_terminate_session_sends_shared_secret(monkeypatch):
    monkeypatch.setattr(settings, "WINBOX_WORKER_TOKEN", "unit-test-token")
    factory, _ = _fake_client(200, {"status": "terminated"})

    with patch.object(winbox_remote.httpx, "AsyncClient", factory):
        await winbox_remote.terminate_session("s")

    assert factory.call_args.kwargs["headers"]["X-Worker-Token"] == "unit-test-token"


def test_requested_subprotocols_parses_header():
    assert _requested_subprotocols("binary, base64") == ["binary", "base64"]
    assert _requested_subprotocols("binary") == ["binary"]
    assert _requested_subprotocols(None) == []
    assert _requested_subprotocols("") == []
