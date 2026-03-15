"""Security response headers middleware.

Adds standard security headers to all API responses:
- X-Content-Type-Options: nosniff (prevent MIME sniffing)
- X-Frame-Options: DENY (prevent clickjacking)
- Referrer-Policy: strict-origin-when-cross-origin
- Cache-Control: no-store (prevent browser caching of API responses)
- Strict-Transport-Security (HSTS, production only -- breaks plain HTTP dev)
- Content-Security-Policy (strict in production, relaxed for dev HMR)

CSP directives:
- script-src 'self' (production) blocks inline scripts -- XSS mitigation
- style-src 'unsafe-inline' required for Tailwind, Framer Motion, Radix, Sonner
- connect-src includes wss:/ws: for SSE and WebSocket connections
- Dev mode adds 'unsafe-inline' and 'unsafe-eval' for Vite HMR
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Production CSP: strict -- no inline scripts allowed
_CSP_PRODUCTION = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self' wss: ws:",
        "worker-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ]
)

# Development CSP: relaxed for Vite HMR (hot module replacement)
_CSP_DEV = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self' http://localhost:* ws://localhost:* wss:",
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ]
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to every API response."""

    def __init__(self, app, environment: str = "dev"):
        super().__init__(app)
        self.is_production = environment != "dev"

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        # Always-on security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Cache-Control"] = "no-store"

        # Content-Security-Policy (environment-aware)
        if self.is_production:
            response.headers["Content-Security-Policy"] = _CSP_PRODUCTION
        else:
            response.headers["Content-Security-Policy"] = _CSP_DEV

        # HSTS only in production (plain HTTP in dev would be blocked)
        if self.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        return response
