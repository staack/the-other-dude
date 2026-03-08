"""Gunicorn configuration for production deployment.

Uses UvicornWorker for async support under gunicorn's process management.
Worker count and timeouts are configurable via environment variables.
"""

import os

# Server socket
bind = os.getenv("GUNICORN_BIND", "0.0.0.0:8000")

# Worker processes
workers = int(os.getenv("GUNICORN_WORKERS", "2"))
worker_class = "uvicorn.workers.UvicornWorker"

# Timeouts
graceful_timeout = int(os.getenv("GUNICORN_GRACEFUL_TIMEOUT", "30"))
timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))
keepalive = int(os.getenv("GUNICORN_KEEPALIVE", "5"))

# Logging -- use stdout/stderr for Docker log collection
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")

# Process naming
proc_name = "mikrotik-api"

# Preload application for faster worker spawning (shared memory for code)
preload_app = True
