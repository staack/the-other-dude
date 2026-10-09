"""Webhook URLs shown to read-only callers must carry no secret material."""

from app.routers.alerts import _mask_url


def test_mask_drops_path_and_query():
    assert (
        _mask_url("https://hooks.slack.com/services/T0/B0/secret?x=1")
        == "https://hooks.slack.com/…"
    )


def test_mask_drops_userinfo():
    masked = _mask_url("https://user:secret@hooks.example.test/hook/token")
    assert "secret" not in masked and "user" not in masked
    assert masked == "https://hooks.example.test/…"


def test_mask_keeps_port():
    assert _mask_url("http://relay.internal:8080/hook") == "http://relay.internal:8080/…"


def test_mask_survives_malformed_url():
    assert _mask_url("https://[bad/path") == "…"


def test_mask_passes_through_empty():
    assert _mask_url(None) is None
    assert _mask_url("") == ""
