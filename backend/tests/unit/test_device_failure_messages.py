"""Per-device failure reasons in bulk adoption must be actionable and safe.

Both bulk loops record `error=str(exc)` for anything that is not an
HTTPException. Measured against realistic failures, that has two faults:

1. Several common exceptions stringify to "". The operator then sees a device
   fail with no cause at all -- rendered as "10.0.0.1: ". This is the same
   empty-failure-reason shape found earlier in the adoption wizard.

2. SQLAlchemy's DBAPIError stringifies to the driver message *plus the full
   SQL and its bound parameters*. For a device INSERT those parameters include
   `encrypted_credentials_transit`, so an OpenBao Transit ciphertext would be
   copied into the API response and shown in the UI. The service's own stated
   policy is that credentials are never returned in any public-facing
   response.

The driver's own message (`exc.orig`) carries the diagnosis without the SQL or
the parameters, which is what these tests pin down.
"""

import asyncio

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.services.device import describe_device_failure


CIPHERTEXT = "vault:v1:SUPERSECRETCIPHERTEXTBLOB=="


def _rls_error() -> DBAPIError:
    """A DBAPIError shaped like the RLS denial measured on the test stack."""
    return DBAPIError.instance(
        statement=(
            "INSERT INTO devices (tenant_id, hostname, ip_address, "
            "encrypted_credentials_transit) VALUES ($1, $2, $3, $4)"
        ),
        params=("00000000-0000-0000-0000-000000000000", "rtr-1", "10.0.0.1", CIPHERTEXT),
        orig=Exception('new row violates row-level security policy for table "devices"'),
        dbapi_base_err=Exception,
    )


@pytest.mark.parametrize(
    "exc",
    [
        httpx.ConnectError(""),
        asyncio.TimeoutError(),
        ConnectionResetError(),
        ValueError(),
    ],
    ids=["ConnectError", "TimeoutError", "ConnectionResetError", "ValueError"],
)
def test_an_exception_with_no_message_still_names_a_cause(exc):
    """ "10.0.0.1: " tells an operator nothing. At minimum, name the failure."""
    described = describe_device_failure(exc)

    assert described.strip(), "a failure reason must never be empty"
    assert type(exc).__name__ in described


def test_a_database_error_reports_the_driver_message():
    described = describe_device_failure(_rls_error())

    assert "row-level security policy" in described
    assert "devices" in described


def test_a_database_error_does_not_leak_bound_parameters():
    """The credential ciphertext must not travel to the client in an error."""
    described = describe_device_failure(_rls_error())

    assert CIPHERTEXT not in described
    assert "vault:v1" not in described
    assert "parameters:" not in described
    assert "INSERT INTO" not in described


def test_a_duplicate_hostname_reports_the_constraint_not_the_row():
    exc = IntegrityError(
        statement="INSERT INTO devices (hostname, encrypted_credentials_transit) VALUES ($1, $2)",
        params=("dup-host", CIPHERTEXT),
        orig=Exception(
            'duplicate key value violates unique constraint "uq_devices_tenant_hostname"'
        ),
    )

    described = describe_device_failure(exc)

    assert "uq_devices_tenant_hostname" in described
    assert CIPHERTEXT not in described


def test_an_http_exception_still_yields_its_detail_verbatim():
    """The probe's diagnosis is already written for the user; do not decorate it."""
    detail = (
        "TLS handshake failed with 10.0.0.1:8729: no cipher overlap. This device "
        "almost certainly has api-ssl enabled without a certificate."
    )

    assert describe_device_failure(HTTPException(status_code=422, detail=detail)) == detail


def test_an_ordinary_exception_with_a_message_keeps_it():
    assert "boom" in describe_device_failure(RuntimeError("boom"))
