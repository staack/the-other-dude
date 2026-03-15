"""SRP-6a server-side authentication service.

Wraps the srptools library for the two-step SRP handshake.
All functions are async, using asyncio.to_thread() because
srptools operations are CPU-bound and synchronous.
"""

import asyncio
import hashlib

from srptools import SRPContext, SRPServerSession
from srptools.constants import PRIME_2048, PRIME_2048_GEN

# Client uses Web Crypto SHA-256 — server must match.
# srptools defaults to SHA-1 which would cause proof mismatch.
_SRP_HASH = hashlib.sha256


async def create_srp_verifier(salt_hex: str, verifier_hex: str) -> tuple[bytes, bytes]:
    """Convert client-provided hex salt and verifier to bytes for storage.

    The client computes v = g^x mod N using 2SKD-derived SRP-x.
    The server stores the verifier directly and never computes x
    from the password.

    Returns:
        Tuple of (salt_bytes, verifier_bytes) ready for database storage.
    """
    return bytes.fromhex(salt_hex), bytes.fromhex(verifier_hex)


async def srp_init(email: str, srp_verifier_hex: str) -> tuple[str, str]:
    """SRP Step 1: Generate server ephemeral (B) and private key (b).

    Args:
        email: User email (SRP identity I).
        srp_verifier_hex: Hex-encoded SRP verifier from database.

    Returns:
        Tuple of (server_public_hex, server_private_hex).
        Caller stores server_private in Redis with 60s TTL.

    Raises:
        ValueError: If SRP initialization fails for any reason.
    """

    def _init() -> tuple[str, str]:
        context = SRPContext(
            email,
            prime=PRIME_2048,
            generator=PRIME_2048_GEN,
            hash_func=_SRP_HASH,
        )
        server_session = SRPServerSession(context, srp_verifier_hex)
        return server_session.public, server_session.private

    try:
        return await asyncio.to_thread(_init)
    except Exception as e:
        raise ValueError(f"SRP initialization failed: {e}") from e


async def srp_verify(
    email: str,
    srp_verifier_hex: str,
    server_private: str,
    client_public: str,
    client_proof: str,
    srp_salt_hex: str,
) -> tuple[bool, str | None]:
    """SRP Step 2: Verify client proof M1, return server proof M2.

    Args:
        email: User email (SRP identity I).
        srp_verifier_hex: Hex-encoded SRP verifier from database.
        server_private: Server private ephemeral from Redis session.
        client_public: Hex-encoded client public ephemeral A.
        client_proof: Hex-encoded client proof M1.
        srp_salt_hex: Hex-encoded SRP salt.

    Returns:
        Tuple of (is_valid, server_proof_hex_or_none).
        If valid, server_proof is M2 for the client to verify.
    """

    def _verify() -> tuple[bool, str | None]:
        context = SRPContext(
            email,
            prime=PRIME_2048,
            generator=PRIME_2048_GEN,
            hash_func=_SRP_HASH,
        )
        server_session = SRPServerSession(context, srp_verifier_hex, private=server_private)
        _key, _key_proof, _key_proof_hash = server_session.process(client_public, srp_salt_hex)
        # srptools verify_proof has a Python 3 bug: hexlify() returns bytes
        # but client_proof is str, so bytes == str is always False.
        # Compare manually with consistent types.
        server_m1 = _key_proof if isinstance(_key_proof, str) else _key_proof.decode("ascii")
        is_valid = client_proof.lower() == server_m1.lower()
        if not is_valid:
            return False, None
        # Return M2 (key_proof_hash), also fixing the bytes/str issue
        m2 = (
            _key_proof_hash if isinstance(_key_proof_hash, str) else _key_proof_hash.decode("ascii")
        )
        return True, m2

    try:
        return await asyncio.to_thread(_verify)
    except Exception as e:
        raise ValueError(f"SRP verification failed: {e}") from e
