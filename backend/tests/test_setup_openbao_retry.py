"""Setup retries must retain the credentials that unlock the existing OpenBao store."""

import importlib.util
from pathlib import Path
import subprocess
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def setup_mod(monkeypatch, tmp_path):
    spec = importlib.util.spec_from_file_location(
        "tod_setup_bao", Path(__file__).resolve().parents[2] / "setup.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "ENV_PROD", tmp_path / ".env.prod")
    return module


def config():
    return dict(
        postgres_db="tod",
        postgres_password="pw",
        app_user_password="app",
        poller_user_password="poll",
        jwt_secret="jwt",
        encryption_key="key",
        admin_email="admin@example.com",
        admin_password="pw",
        app_base_url="https://example.com",
        cors_origins="https://example.com",
    )


@pytest.mark.parametrize(
    "existing",
    [
        "OPENBAO_TOKEN=old-token\nBAO_UNSEAL_KEY=old-key==\n",
        "OPENBAO_TOKEN=\"old-token\"\nBAO_UNSEAL_KEY='old-key=='\n",
    ],
)
def test_retry_keeps_existing_openbao_credentials(setup_mod, existing):
    setup_mod.ENV_PROD.write_text(existing)
    setup_mod.write_env_prod(config())
    saved = setup_mod.ENV_PROD.read_text()
    assert "OPENBAO_TOKEN=old-token\n" in saved
    assert "BAO_UNSEAL_KEY=old-key==\n" in saved
    assert setup_mod.ENV_PROD.stat().st_mode & 0o777 == 0o600


def test_first_run_retains_bootstrap_placeholders(setup_mod):
    setup_mod.write_env_prod(config())
    saved = setup_mod.ENV_PROD.read_text()
    assert "OPENBAO_TOKEN=PLACEHOLDER_RUN_SETUP\n" in saved
    assert "BAO_UNSEAL_KEY=PLACEHOLDER_RUN_SETUP\n" in saved


def test_partial_credentials_never_discard_known_unseal_key(setup_mod):
    setup_mod.ENV_PROD.write_text("OPENBAO_TOKEN=PLACEHOLDER_RUN_SETUP\nBAO_UNSEAL_KEY=old-key\n")
    setup_mod.write_env_prod(config())
    assert "BAO_UNSEAL_KEY=old-key\n" in setup_mod.ENV_PROD.read_text()


def test_bootstrap_start_failure_has_specific_reason(setup_mod, monkeypatch):
    monkeypatch.setattr(
        setup_mod,
        "run_compose",
        MagicMock(side_effect=subprocess.CalledProcessError(1, "docker compose")),
    )
    cfg = {}
    assert not setup_mod.bootstrap_openbao(cfg)
    assert cfg["openbao_error"] == "Starting OpenBao containers failed (CalledProcessError)"


def test_healthy_existing_store_reuses_retained_credentials(setup_mod, monkeypatch):
    setup_mod.ENV_PROD.write_text("OPENBAO_TOKEN=old-token\nBAO_UNSEAL_KEY=old-key\n")
    setup_mod.write_env_prod(config())
    monkeypatch.setattr(
        setup_mod,
        "run_compose",
        MagicMock(
            return_value=subprocess.CompletedProcess([], 0, stdout="already initialized", stderr="")
        ),
    )
    monkeypatch.setattr(
        setup_mod.subprocess,
        "run",
        MagicMock(return_value=subprocess.CompletedProcess([], 0, stdout="healthy\n")),
    )
    assert setup_mod.bootstrap_openbao({})
