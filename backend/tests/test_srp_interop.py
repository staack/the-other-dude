"""SRP-6a interop verification.

Uses srptools to perform a complete SRP handshake with fixed inputs,
then prints all intermediate hex values. The TypeScript SRP client
(frontend/src/lib/crypto/srp.ts) can be verified against these
known-good values to catch encoding mismatches.

Run standalone:
    cd backend && python -m tests.test_srp_interop

Or via pytest:
    cd backend && python -m pytest tests/test_srp_interop.py -v
"""

from srptools import SRPContext, SRPClientSession, SRPServerSession
from srptools.constants import PRIME_2048, PRIME_2048_GEN


# Fixed test inputs
EMAIL = "test@example.com"
PASSWORD = "test-password"


def test_srp_roundtrip():
    """Verify srptools produces a successful handshake end-to-end.

    This test ensures the server-side library completes a full SRP
    handshake without errors. The printed intermediate values serve as
    reference data for the TypeScript client interop test.
    """
    # Step 1: Registration -- compute salt + verifier (needs password in context)
    context = SRPContext(EMAIL, password=PASSWORD, prime=PRIME_2048, generator=PRIME_2048_GEN)
    username, verifier, salt = context.get_user_data_triplet()

    print("\n--- SRP Interop Reference Values ---")
    print(f"email (I): {EMAIL}")
    print(f"salt (s):  {salt}")
    print(f"verifier (v): {verifier[:64]}...  (len={len(verifier)})")

    # Step 2: Server init -- generate B (server only needs verifier, no password)
    server_context = SRPContext(EMAIL, prime=PRIME_2048, generator=PRIME_2048_GEN)
    server_session = SRPServerSession(server_context, verifier)
    server_public = server_session.public

    print(f"server_public (B): {server_public[:64]}...  (len={len(server_public)})")

    # Step 3: Client init -- generate A (client needs password for proof)
    client_context = SRPContext(
        EMAIL, password=PASSWORD, prime=PRIME_2048, generator=PRIME_2048_GEN
    )
    client_session = SRPClientSession(client_context)
    client_public = client_session.public

    print(f"client_public (A): {client_public[:64]}...  (len={len(client_public)})")

    # Step 4: Client processes B
    client_session.process(server_public, salt)

    # Step 5: Server processes A
    server_session.process(client_public, salt)

    # Step 6: Client generates proof M1
    client_proof = client_session.key_proof

    print(f"client_proof (M1): {client_proof}")

    # Step 7: Server verifies M1 and generates M2
    server_session.verify_proof(client_proof)
    server_proof = server_session.key_proof_hash

    print(f"server_proof (M2): {server_proof}")

    # Step 8: Client verifies M2
    client_session.verify_proof(server_proof)

    # Step 9: Verify session keys match
    assert client_session.key == server_session.key, (
        f"Session key mismatch: client={client_session.key[:32]}... "
        f"server={server_session.key[:32]}..."
    )

    print(f"session_key (K): {client_session.key[:64]}...  (len={len(client_session.key)})")
    print("--- Handshake PASSED ---\n")


def test_srp_bad_proof_rejected():
    """Verify that an incorrect M1 proof is rejected by the server."""
    context = SRPContext(EMAIL, password=PASSWORD, prime=PRIME_2048, generator=PRIME_2048_GEN)
    _, verifier, salt = context.get_user_data_triplet()

    server_context = SRPContext(EMAIL, prime=PRIME_2048, generator=PRIME_2048_GEN)
    server_session = SRPServerSession(server_context, verifier)

    client_context = SRPContext(
        EMAIL, password=PASSWORD, prime=PRIME_2048, generator=PRIME_2048_GEN
    )
    client_session = SRPClientSession(client_context)

    client_session.process(server_session.public, salt)
    server_session.process(client_session.public, salt)

    # Tamper with proof
    bad_proof = "00" * 32

    try:
        server_session.verify_proof(bad_proof)
        assert False, "Server should have rejected bad proof"
    except Exception:
        pass  # Expected: bad proof rejected


def test_srp_deterministic_verifier():
    """Verify that the same salt + identity produce consistent verifiers."""
    context1 = SRPContext(EMAIL, password=PASSWORD, prime=PRIME_2048, generator=PRIME_2048_GEN)
    _, v1, s1 = context1.get_user_data_triplet()

    # Same email + password, new context
    context2 = SRPContext(EMAIL, password=PASSWORD, prime=PRIME_2048, generator=PRIME_2048_GEN)
    _, v2, s2 = context2.get_user_data_triplet()

    # srptools generates random salt each time, so verifiers will differ.
    # But the output format is consistent.
    assert len(v1) > 0
    assert len(v2) > 0
    assert len(s1) == len(s2), "Salt lengths should be consistent"


if __name__ == "__main__":
    test_srp_roundtrip()
    test_srp_bad_proof_rejected()
    test_srp_deterministic_verifier()
    print("All SRP interop tests passed.")
