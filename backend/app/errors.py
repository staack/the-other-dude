"""Error handlers that keep submitted secrets out of API responses and logs.

Pydantic's ValidationError.errors() includes an "input" key holding the raw
submitted value, and for a model-level validator that value is the entire
request body. FastAPI's default 422 handler serializes those entries verbatim,
so a request carrying a credential gets that credential echoed back -- and into
any middleware, tracing, or log line that records the response.

Redacting "input" removes the echo while leaving the parts a caller actually
needs: which field failed, and why.
"""

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

__all__ = ["install_validation_error_handler", "redact_validation_errors"]

# Kept from each error entry. "input" and "ctx" are dropped: "input" is the raw
# submitted value, and "ctx" can embed it inside the validator's own message.
_SAFE_KEYS = ("type", "loc", "msg")


def redact_validation_errors(errors: list[dict]) -> list[dict]:
    """Strip submitted values from Pydantic error entries."""
    return [{k: e[k] for k in _SAFE_KEYS if k in e} for e in errors]


def install_validation_error_handler(app: FastAPI) -> None:
    """Register a 422 handler that does not echo submitted values."""

    @app.exception_handler(RequestValidationError)
    async def _handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": redact_validation_errors(exc.errors())},
        )
