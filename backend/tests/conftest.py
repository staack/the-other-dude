"""Shared test fixtures for the backend test suite.

Phase 7: Minimal fixtures for unit tests (no database, no async).
Phase 10: Integration test fixtures added in tests/integration/conftest.py.

Pytest marker registration and shared configuration lives here.
"""


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers", "integration: marks tests as integration tests requiring PostgreSQL"
    )
