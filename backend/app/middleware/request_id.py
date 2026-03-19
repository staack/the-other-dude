"""Request ID middleware for structured logging context.

Generates or extracts a request ID for every incoming request and binds it
(along with tenant_id from JWT) to structlog's contextvars so that all log
lines emitted during the request include these correlation fields.
"""

import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Middleware that binds request_id and tenant_id to structlog context."""

    async def dispatch(self, request: Request, call_next):
        # CRITICAL: Clear stale context from previous request to prevent leaks
        structlog.contextvars.clear_contextvars()

        # Generate or extract request ID
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))

        # Best-effort tenant_id extraction from JWT (does not fail if no token)
        tenant_id = self._extract_tenant_id(request)

        # Bind to structlog context -- all subsequent log calls include these fields
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            tenant_id=tenant_id,
        )

        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Correlation-Scope"] = "tenant"
        return response

    def _extract_tenant_id(self, request: Request) -> str | None:
        """Best-effort extraction of tenant_id from JWT.

        Looks in cookies first (access_token), then Authorization header.
        Returns None if no valid token is found -- this is fine for
        unauthenticated endpoints like /login.
        """
        token = request.cookies.get("access_token")
        if not token:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]

        if not token:
            return None

        try:
            from jose import jwt as jose_jwt

            from app.config import settings

            payload = jose_jwt.decode(
                token,
                settings.JWT_SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM],
            )
            return payload.get("tenant_id")
        except Exception:
            return None
