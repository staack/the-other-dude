"""Regression tests for connection URLs written by the root setup.py.

Issue #2: a PostgreSQL password containing @ was interpolated raw into
DATABASE_URL, so the @ was parsed as the userinfo/host separator and the API
failed at startup with InvalidPasswordError. Passwords embedded in a URL must
be percent-encoded; POSTGRES_PASSWORD must stay raw because Postgres takes the
literal value.
"""

import importlib.util
import pathlib
import sys

import pytest
from sqlalchemy.engine.url import make_url

SETUP_PY = pathlib.Path(__file__).resolve().parents[2] / "setup.py"

# Passwords that break a naively-interpolated URL, one delimiter each.
NASTY_PASSWORDS = [
    "Example@2026",
    "p@ss@word",
    "colon:pw",
    "slash/pw",
    "hash#pw",
    "question?pw",
    "space pw",
    "plus+pw",
    "everything@:/?#&= pw",
]


@pytest.fixture(scope="module")
def setup_module_():
    """Load the root setup.py as a module without executing its CLI."""
    spec = importlib.util.spec_from_file_location("tod_setup", SETUP_PY)
    module = importlib.util.module_from_spec(spec)
    sys.modules["tod_setup"] = module
    spec.loader.exec_module(module)
    yield module
    del sys.modules["tod_setup"]


def _write_env(setup_mod, tmp_path, password):
    """Run the real write_env_prod and return the parsed .env.prod mapping."""
    setup_mod.ENV_PROD = tmp_path / ".env.prod"
    setup_mod.write_env_prod(
        {
            "postgres_db": "tod",
            "postgres_password": password,
            "app_user_password": password,
            "poller_user_password": password,
            "jwt_secret": "jwt",
            "encryption_key": "key",
            "tod_version": "test",
            "admin_email": "admin@example.com",
            "admin_password": "admin",
            "app_base_url": "https://tod.example.com",
            "cors_origins": "https://tod.example.com",
            "smtp_configured": False,
            "telemetry_enabled": False,
        }
    )
    return {
        line.split("=", 1)[0]: line.split("=", 1)[1]
        for line in setup_mod.ENV_PROD.read_text().splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    }


@pytest.mark.parametrize("password", NASTY_PASSWORDS)
@pytest.mark.parametrize(
    "url_key",
    ["DATABASE_URL", "SYNC_DATABASE_URL", "APP_USER_DATABASE_URL"],
)
def test_sqlalchemy_urls_round_trip_special_characters(setup_module_, tmp_path, password, url_key):
    url = make_url(_write_env(setup_module_, tmp_path, password)[url_key])

    assert url.password == password
    assert url.host == "postgres"
    assert url.port == 5432
    assert url.database == "tod"


@pytest.mark.parametrize("password", NASTY_PASSWORDS)
def test_poller_url_round_trips_special_characters(setup_module_, tmp_path, password):
    from urllib.parse import unquote, urlsplit

    parts = urlsplit(_write_env(setup_module_, tmp_path, password)["POLLER_DATABASE_URL"])

    assert unquote(parts.password) == password
    assert parts.hostname == "postgres"
    assert parts.port == 5432


@pytest.mark.parametrize("password", NASTY_PASSWORDS)
def test_postgres_password_is_not_encoded(setup_module_, tmp_path, password):
    """Postgres reads POSTGRES_PASSWORD literally — encoding it would break auth."""
    assert _write_env(setup_module_, tmp_path, password)["POSTGRES_PASSWORD"] == password
