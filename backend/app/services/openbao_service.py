"""
OpenBao Transit secrets engine client for per-tenant envelope encryption.

Provides encrypt/decrypt operations via OpenBao's HTTP API. Each tenant gets
a dedicated Transit key (tenant_{uuid}) for AES-256-GCM encryption. The key
material never leaves OpenBao -- the application only sees ciphertext.

Ciphertext format: "vault:v1:base64..." (compatible with Vault Transit format)
"""
import base64
import logging
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class OpenBaoTransitService:
    """Async client for OpenBao Transit secrets engine."""

    def __init__(self, addr: str | None = None, token: str | None = None):
        self.addr = addr or settings.OPENBAO_ADDR
        self.token = token or settings.OPENBAO_TOKEN
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.addr,
                headers={"X-Vault-Token": self.token},
                timeout=5.0,
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def create_tenant_key(self, tenant_id: str) -> None:
        """Create Transit encryption keys for a tenant (credential + data). Idempotent."""
        client = await self._get_client()

        # Credential key: tenant_{uuid}
        key_name = f"tenant_{tenant_id}"
        resp = await client.post(
            f"/v1/transit/keys/{key_name}",
            json={"type": "aes256-gcm96"},
        )
        if resp.status_code not in (200, 204):
            resp.raise_for_status()
        logger.info("OpenBao Transit key ensured", extra={"key_name": key_name})

        # Data key: tenant_{uuid}_data (Phase 30)
        await self.create_tenant_data_key(tenant_id)

    async def encrypt(self, tenant_id: str, plaintext: bytes) -> str:
        """Encrypt plaintext via Transit engine. Returns ciphertext string."""
        client = await self._get_client()
        key_name = f"tenant_{tenant_id}"
        resp = await client.post(
            f"/v1/transit/encrypt/{key_name}",
            json={"plaintext": base64.b64encode(plaintext).decode()},
        )
        resp.raise_for_status()
        ciphertext = resp.json()["data"]["ciphertext"]
        return ciphertext  # "vault:v1:..."

    async def decrypt(self, tenant_id: str, ciphertext: str) -> bytes:
        """Decrypt Transit ciphertext. Returns plaintext bytes."""
        client = await self._get_client()
        key_name = f"tenant_{tenant_id}"
        resp = await client.post(
            f"/v1/transit/decrypt/{key_name}",
            json={"ciphertext": ciphertext},
        )
        resp.raise_for_status()
        plaintext_b64 = resp.json()["data"]["plaintext"]
        return base64.b64decode(plaintext_b64)

    async def key_exists(self, tenant_id: str) -> bool:
        """Check if a Transit key exists for a tenant."""
        client = await self._get_client()
        key_name = f"tenant_{tenant_id}"
        resp = await client.get(f"/v1/transit/keys/{key_name}")
        return resp.status_code == 200

    # ------------------------------------------------------------------
    # Data encryption keys (tenant_{uuid}_data) — Phase 30
    # ------------------------------------------------------------------

    async def create_tenant_data_key(self, tenant_id: str) -> None:
        """Create a Transit data encryption key for a tenant. Idempotent.

        Data keys use the suffix '_data' to separate them from credential keys.
        Key naming: tenant_{uuid}_data (vs tenant_{uuid} for credentials).
        """
        client = await self._get_client()
        key_name = f"tenant_{tenant_id}_data"
        resp = await client.post(
            f"/v1/transit/keys/{key_name}",
            json={"type": "aes256-gcm96"},
        )
        if resp.status_code not in (200, 204):
            resp.raise_for_status()
        logger.info("OpenBao Transit data key ensured", extra={"key_name": key_name})

    async def ensure_tenant_data_key(self, tenant_id: str) -> None:
        """Ensure a data encryption key exists for a tenant. Idempotent.

        Checks existence first and creates if missing. Safe to call on every
        encrypt operation (fast path: single GET to check existence).
        """
        client = await self._get_client()
        key_name = f"tenant_{tenant_id}_data"
        resp = await client.get(f"/v1/transit/keys/{key_name}")
        if resp.status_code != 200:
            await self.create_tenant_data_key(tenant_id)

    async def encrypt_data(self, tenant_id: str, plaintext: bytes) -> str:
        """Encrypt data via Transit using per-tenant data key.

        Uses the tenant_{uuid}_data key (separate from credential key).

        Args:
            tenant_id: Tenant UUID string.
            plaintext: Raw bytes to encrypt.

        Returns:
            Transit ciphertext string (vault:v1:...).
        """
        client = await self._get_client()
        key_name = f"tenant_{tenant_id}_data"
        resp = await client.post(
            f"/v1/transit/encrypt/{key_name}",
            json={"plaintext": base64.b64encode(plaintext).decode()},
        )
        resp.raise_for_status()
        return resp.json()["data"]["ciphertext"]

    async def decrypt_data(self, tenant_id: str, ciphertext: str) -> bytes:
        """Decrypt Transit data ciphertext using per-tenant data key.

        Args:
            tenant_id: Tenant UUID string.
            ciphertext: Transit ciphertext (vault:v1:...).

        Returns:
            Decrypted plaintext bytes.
        """
        client = await self._get_client()
        key_name = f"tenant_{tenant_id}_data"
        resp = await client.post(
            f"/v1/transit/decrypt/{key_name}",
            json={"ciphertext": ciphertext},
        )
        resp.raise_for_status()
        plaintext_b64 = resp.json()["data"]["plaintext"]
        return base64.b64decode(plaintext_b64)


# Module-level singleton
_openbao_service: Optional[OpenBaoTransitService] = None


def get_openbao_service() -> OpenBaoTransitService:
    """Return module-level OpenBao Transit service singleton."""
    global _openbao_service
    if _openbao_service is None:
        _openbao_service = OpenBaoTransitService()
    return _openbao_service
