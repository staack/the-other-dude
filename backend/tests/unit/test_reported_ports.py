"""Custom SSH ports reach certificate deployment, not just the database."""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError
from starlette.requests import Request

from app.schemas.device import DeviceCreate, DeviceUpdate


@pytest.mark.parametrize("schema", [DeviceCreate, DeviceUpdate])
@pytest.mark.parametrize("port", [0, -1, 65536])
def test_invalid_ssh_ports_rejected(schema, port):
    with pytest.raises(ValidationError):
        schema(ip_address="192.0.2.1", username="test", password="test", ssh_port=port)


@pytest.mark.parametrize("port", [1, 22, 65211, 65535])
def test_ssh_port_schema_roundtrip(port):
    assert (
        DeviceCreate(
            ip_address="192.0.2.1", username="test", password="test", ssh_port=port
        ).ssh_port
        == port
    )
    assert DeviceUpdate(ssh_port=port).ssh_port == port


@pytest.mark.parametrize("operation", ["deploy_cert", "bulk_deploy", "rotate_cert"])
@pytest.mark.parametrize("port", [65211, None, 22])
async def test_certificate_operations_forward_device_port(monkeypatch, operation, port):
    from app.routers import certificates as c

    tenant_id, device_id, cert_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    device = SimpleNamespace(
        id=device_id, ssh_port=port, hostname="test", ip_address="192.0.2.1", tls_mode="auto"
    )
    cert = SimpleNamespace(id=cert_id, device_id=device_id, status="issued")
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = device
    db.execute.return_value = result
    monkeypatch.setattr(c.limiter, "enabled", False)
    monkeypatch.setattr(c, "_get_tenant_id", AsyncMock(return_value=tenant_id))
    monkeypatch.setattr(c, "_get_cert_with_tenant_check", AsyncMock(return_value=cert))
    monkeypatch.setattr(c, "_get_device_for_tenant", AsyncMock(return_value=device))
    monkeypatch.setattr(c, "get_device_certs", AsyncMock(return_value=[cert]))
    monkeypatch.setattr(c, "get_ca_for_tenant", AsyncMock(return_value=MagicMock()))
    monkeypatch.setattr(c, "sign_device_cert", AsyncMock(return_value=cert))
    monkeypatch.setattr(c, "update_cert_status", AsyncMock())
    monkeypatch.setattr(c, "get_cert_for_deploy", AsyncMock(return_value=("cert", "key", "ca")))
    monkeypatch.setattr(c, "log_action", AsyncMock())
    deploy = AsyncMock(return_value={"success": True, "cert_name_on_device": "test"})
    monkeypatch.setattr(c, "_deploy_cert_via_nats", deploy)
    request = Request(
        {"type": "http", "method": "POST", "path": "/", "headers": [], "client": ("127.0.0.1", 1)}
    )
    args = dict(
        request=request,
        tenant_id=tenant_id,
        current_user=SimpleNamespace(user_id=uuid.uuid4()),
        db=db,
    )
    if operation == "bulk_deploy":
        args["body"] = c.BulkCertDeployRequest(device_ids=[device_id])
    else:
        args["cert_id"] = cert_id
    await getattr(c, operation)(**args)
    assert deploy.await_count == 1
    assert deploy.await_args.kwargs["ssh_port"] == (port or 22)
