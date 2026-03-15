"""Unit tests for security hardening.

Tests cover:
- Production startup validation (insecure defaults rejection)
- Security headers middleware (per-environment header behavior)

These are pure function/middleware tests -- no database or async required
for startup validation, async only for middleware tests.
"""

from types import SimpleNamespace

import pytest

from app.config import KNOWN_INSECURE_DEFAULTS, validate_production_settings


class TestStartupValidation:
    """Tests for validate_production_settings()."""

    def _make_settings(self, **kwargs):
        """Create a mock settings object with given field values."""
        defaults = {
            "ENVIRONMENT": "dev",
            "JWT_SECRET_KEY": "change-this-in-production-use-a-long-random-string",
            "CREDENTIAL_ENCRYPTION_KEY": "LLLjnfBZTSycvL2U07HDSxUeTtLxb9cZzryQl0R9E4w=",
        }
        defaults.update(kwargs)
        return SimpleNamespace(**defaults)

    def test_production_rejects_insecure_jwt_secret(self):
        """Production with default JWT secret must exit."""
        settings = self._make_settings(
            ENVIRONMENT="production",
            JWT_SECRET_KEY=KNOWN_INSECURE_DEFAULTS["JWT_SECRET_KEY"][0],
        )
        with pytest.raises(SystemExit) as exc_info:
            validate_production_settings(settings)
        assert exc_info.value.code == 1

    def test_production_rejects_insecure_encryption_key(self):
        """Production with default encryption key must exit."""
        settings = self._make_settings(
            ENVIRONMENT="production",
            JWT_SECRET_KEY="a-real-secure-jwt-secret-that-is-long-enough",
            CREDENTIAL_ENCRYPTION_KEY=KNOWN_INSECURE_DEFAULTS["CREDENTIAL_ENCRYPTION_KEY"][0],
        )
        with pytest.raises(SystemExit) as exc_info:
            validate_production_settings(settings)
        assert exc_info.value.code == 1

    def test_dev_allows_insecure_defaults(self):
        """Dev environment allows insecure defaults without error."""
        settings = self._make_settings(
            ENVIRONMENT="dev",
            JWT_SECRET_KEY=KNOWN_INSECURE_DEFAULTS["JWT_SECRET_KEY"][0],
            CREDENTIAL_ENCRYPTION_KEY=KNOWN_INSECURE_DEFAULTS["CREDENTIAL_ENCRYPTION_KEY"][0],
        )
        # Should NOT raise
        validate_production_settings(settings)

    def test_production_allows_secure_values(self):
        """Production with non-default secrets should pass."""
        settings = self._make_settings(
            ENVIRONMENT="production",
            JWT_SECRET_KEY="a-real-secure-jwt-secret-that-is-long-enough-for-production",
            CREDENTIAL_ENCRYPTION_KEY="dGhpcyBpcyBhIHNlY3VyZSBrZXkgdGhhdCBpcw==",
        )
        # Should NOT raise
        validate_production_settings(settings)


class TestSecurityHeadersMiddleware:
    """Tests for SecurityHeadersMiddleware."""

    @pytest.fixture
    def prod_app(self):
        """Create a minimal FastAPI app with security middleware in production mode."""
        from fastapi import FastAPI
        from app.middleware.security_headers import SecurityHeadersMiddleware

        app = FastAPI()
        app.add_middleware(SecurityHeadersMiddleware, environment="production")

        @app.get("/test")
        async def test_endpoint():
            return {"status": "ok"}

        return app

    @pytest.fixture
    def dev_app(self):
        """Create a minimal FastAPI app with security middleware in dev mode."""
        from fastapi import FastAPI
        from app.middleware.security_headers import SecurityHeadersMiddleware

        app = FastAPI()
        app.add_middleware(SecurityHeadersMiddleware, environment="dev")

        @app.get("/test")
        async def test_endpoint():
            return {"status": "ok"}

        return app

    @pytest.mark.asyncio
    async def test_production_includes_hsts(self, prod_app):
        """Production responses must include HSTS header."""
        import httpx

        transport = httpx.ASGITransport(app=prod_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        assert response.status_code == 200
        assert (
            response.headers["strict-transport-security"] == "max-age=31536000; includeSubDomains"
        )
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["cache-control"] == "no-store"

    @pytest.mark.asyncio
    async def test_dev_excludes_hsts(self, dev_app):
        """Dev responses must NOT include HSTS (breaks plain HTTP)."""
        import httpx

        transport = httpx.ASGITransport(app=dev_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        assert response.status_code == 200
        assert "strict-transport-security" not in response.headers
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["cache-control"] == "no-store"

    @pytest.mark.asyncio
    async def test_csp_header_present_production(self, prod_app):
        """Production responses must include CSP header."""
        import httpx

        transport = httpx.ASGITransport(app=prod_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        assert "content-security-policy" in response.headers
        csp = response.headers["content-security-policy"]
        assert "default-src 'self'" in csp
        assert "script-src" in csp

    @pytest.mark.asyncio
    async def test_csp_header_present_dev(self, dev_app):
        """Dev responses must include CSP header."""
        import httpx

        transport = httpx.ASGITransport(app=dev_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        assert "content-security-policy" in response.headers
        csp = response.headers["content-security-policy"]
        assert "default-src 'self'" in csp

    @pytest.mark.asyncio
    async def test_csp_production_blocks_inline_scripts(self, prod_app):
        """Production CSP must block inline scripts (no unsafe-inline in script-src)."""
        import httpx

        transport = httpx.ASGITransport(app=prod_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        csp = response.headers["content-security-policy"]
        # Extract the script-src directive value
        script_src = [d for d in csp.split(";") if "script-src" in d][0]
        assert "'unsafe-inline'" not in script_src
        assert "'unsafe-eval'" not in script_src
        assert "'self'" in script_src

    @pytest.mark.asyncio
    async def test_csp_dev_allows_unsafe_inline(self, dev_app):
        """Dev CSP must allow unsafe-inline and unsafe-eval for Vite HMR."""
        import httpx

        transport = httpx.ASGITransport(app=dev_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        csp = response.headers["content-security-policy"]
        script_src = [d for d in csp.split(";") if "script-src" in d][0]
        assert "'unsafe-inline'" in script_src
        assert "'unsafe-eval'" in script_src

    @pytest.mark.asyncio
    async def test_csp_production_allows_inline_styles(self, prod_app):
        """Production CSP must allow unsafe-inline for styles (Tailwind, Framer Motion, Radix)."""
        import httpx

        transport = httpx.ASGITransport(app=prod_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        csp = response.headers["content-security-policy"]
        style_src = [d for d in csp.split(";") if "style-src" in d][0]
        assert "'unsafe-inline'" in style_src

    @pytest.mark.asyncio
    async def test_csp_allows_websocket_connections(self, prod_app):
        """CSP must allow wss: and ws: for SSE/WebSocket connections."""
        import httpx

        transport = httpx.ASGITransport(app=prod_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        csp = response.headers["content-security-policy"]
        connect_src = [d for d in csp.split(";") if "connect-src" in d][0]
        assert "wss:" in connect_src
        assert "ws:" in connect_src

    @pytest.mark.asyncio
    async def test_csp_frame_ancestors_none(self, prod_app):
        """CSP must include frame-ancestors 'none' (anti-clickjacking)."""
        import httpx

        transport = httpx.ASGITransport(app=prod_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        csp = response.headers["content-security-policy"]
        assert "frame-ancestors 'none'" in csp
