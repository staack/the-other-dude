"""A 422 validation response must never echo submitted secrets.

Pydantic's ValidationError.errors() carries an "input" key holding the raw
submitted value. For a model-level validator that input is the *entire request
body*, so any credential in the payload is echoed back in FastAPI's default 422
response -- and into anything that logs it.

This affects SSH key passphrases and private keys, and already affected RouterOS
passwords and SNMP v3 auth/priv passphrases.
"""

import httpx
import pytest
from fastapi import FastAPI
from pydantic import BaseModel, SecretStr, model_validator

from app.errors import install_validation_error_handler


class _CredentialPayload(BaseModel):
    name: str
    password: str | None = None
    key_passphrase: SecretStr | None = None

    @model_validator(mode="after")
    def _require_name(self):
        if not self.name:
            raise ValueError("name is required")
        return self


@pytest.fixture
def app():
    application = FastAPI()
    install_validation_error_handler(application)

    @application.post("/thing")
    async def create(payload: _CredentialPayload):  # pragma: no cover - never reached
        return {"ok": True}

    return application


async def _post(app, body):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post("/thing", json=body)


@pytest.mark.asyncio
async def test_422_body_does_not_echo_a_passphrase(app):
    response = await _post(
        app, {"name": "", "key_passphrase": "hunter2", "password": "S3cret!"}
    )
    assert response.status_code == 422
    assert "hunter2" not in response.text
    assert "S3cret!" not in response.text


@pytest.mark.asyncio
async def test_422_still_says_which_field_was_wrong(app):
    """Redaction must not make the error useless to the caller."""
    response = await _post(app, {"name": "", "key_passphrase": "hunter2"})
    assert response.status_code == 422
    assert "name is required" in response.text


@pytest.mark.asyncio
async def test_422_reports_missing_required_fields(app):
    response = await _post(app, {"password": "S3cret!"})
    assert response.status_code == 422
    body = response.json()
    assert body["detail"][0]["loc"] == ["body", "name"]
    assert "S3cret!" not in response.text


def test_real_credential_profile_errors_are_redacted():
    """The payload that motivated this: every secret a profile can carry.

    Without redaction, Pydantic echoes the whole body, so the RouterOS password
    and both SNMP v3 passphrases come back in the 422.

    The routeros and snmp_v3 rows are the load-bearing ones: they fail a
    model-level validator, whose "input" is the entire request body. The ssh_key
    row currently fails the credential_type *field* validator instead, so its
    "input" is only that field and it cannot leak yet -- it becomes load-bearing
    when the ssh_key credential type lands.
    """
    from pydantic import ValidationError

    from app.errors import redact_validation_errors
    from app.schemas.credential_profile import CredentialProfileCreate

    secrets = ["hunter2", "S3cret!", "authpass1", "privpass1"]
    payloads = [
        dict(name="k", credential_type="ssh_key", username="", key_passphrase="hunter2"),
        dict(name="p", credential_type="routeros", username="", password="S3cret!"),
        dict(
            name="s",
            credential_type="snmp_v3",
            username="",
            security_level="auth_priv",
            auth_passphrase="authpass1",
            priv_passphrase="privpass1",
        ),
    ]

    for payload in payloads:
        try:
            CredentialProfileCreate(**payload)
        except ValidationError as exc:
            redacted = str(redact_validation_errors(exc.errors()))
            for secret in secrets:
                assert secret not in redacted, f"{secret} leaked for {payload['credential_type']}"
        else:  # pragma: no cover
            pytest.fail(f"expected a validation error for {payload}")
