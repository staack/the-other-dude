"""Structured logging configuration for the FastAPI backend.

Uses structlog with two rendering modes:
- Dev mode (ENVIRONMENT=dev or DEBUG=true): colored console output
- Prod mode: machine-parseable JSON output

Must be called once during app startup (in lifespan), NOT at module import time,
so tests can override the configuration.
"""

import logging
import os

import structlog


def configure_logging() -> None:
    """Configure structlog for the FastAPI application.

    Dev mode: colored console output with human-readable formatting.
    Prod mode: JSON output with machine-parseable fields.

    Must be called once during app startup (in lifespan), NOT at module import time,
    so tests can override the configuration.
    """
    is_dev = os.getenv("ENVIRONMENT", "dev") == "dev"
    log_level_name = os.getenv("LOG_LEVEL", "debug" if is_dev else "info").upper()
    log_level = getattr(logging, log_level_name, logging.INFO)

    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
    ]

    if is_dev:
        renderer = structlog.dev.ConsoleRenderer()
    else:
        renderer = structlog.processors.JSONRenderer()

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # Capture stdlib loggers (uvicorn, SQLAlchemy, alembic) into structlog pipeline
    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )

    handler = logging.StreamHandler()
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(log_level)

    # Quiet down noisy libraries in dev
    if is_dev:
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Get a structlog bound logger.

    Use this instead of logging.getLogger() throughout the application.
    """
    return structlog.get_logger(name)
