"""Rate limiting middleware using slowapi with Redis backend.

Per-route rate limits only -- no global limits to avoid blocking the
Go poller, NATS subscribers, and health check endpoints.

Rate limit data uses Redis DB 1 (separate from app data in DB 0).
"""

from fastapi import FastAPI
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.config import settings


def _get_redis_url() -> str:
    """Return Redis URL pointing to DB 1 for rate limit storage.

    Keeps rate limit counters separate from application data in DB 0.
    """
    url = settings.REDIS_URL
    if url.endswith("/0"):
        return url[:-2] + "/1"
    # If no DB specified or different DB, append /1
    if url.rstrip("/").split("/")[-1].isdigit():
        # Replace existing DB number
        parts = url.rsplit("/", 1)
        return parts[0] + "/1"
    return url.rstrip("/") + "/1"


limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=_get_redis_url(),
    default_limits=[],  # No global limits -- per-route only
)


def setup_rate_limiting(app: FastAPI) -> None:
    """Register the rate limiter on the FastAPI app.

    This sets app.state.limiter (required by slowapi) and registers
    the 429 exception handler. It does NOT add middleware -- the
    @limiter.limit() decorators handle actual limiting per-route.
    """
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
