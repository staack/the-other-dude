"""The xpra HTML5 client is served through the API and shown in an iframe.

The API's default headers forbid framing and inline scripts, which is right
for JSON routes and wrong for that one route; and httpx hands the proxy
decoded bodies, so the upstream Content-Encoding must not be forwarded.
"""

from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from app.middleware.security_headers import SecurityHeadersMiddleware
from app.routers.winbox_remote import _proxied_response_headers

XPRA_PATH = "/api/tenants/t/devices/d/winbox-remote-sessions/s/xpra/index.html"


def _client(environment: str) -> TestClient:
    async def ok(request):
        return PlainTextResponse("ok")

    app = Starlette(routes=[Route("/api/{rest:path}", ok)])
    app.add_middleware(SecurityHeadersMiddleware, environment=environment)
    return TestClient(app)


def test_xpra_route_may_be_framed_and_run_inline_scripts():
    for env in ("dev", "production"):
        resp = _client(env).get(XPRA_PATH)
        csp = resp.headers["content-security-policy"]
        assert resp.headers["x-frame-options"] == "SAMEORIGIN", env
        assert "frame-ancestors 'self'" in csp, env
        assert "'unsafe-inline'" in csp and "'unsafe-eval'" in csp, env
        assert "frame-ancestors 'none'" not in csp, env


def test_other_api_routes_keep_the_strict_headers():
    resp = _client("production").get("/api/tenants/t/devices")
    assert resp.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in resp.headers["content-security-policy"]


def test_proxied_headers_drop_encoding_of_decoded_bodies():
    upstream = {
        "content-type": "text/html",
        "content-encoding": "gzip",
        "content-length": "123",
        "cache-control": "no-cache",
        "server": "xpra",
    }
    assert _proxied_response_headers(upstream) == {
        "content-type": "text/html",
        "cache-control": "no-cache",
    }
