#!/usr/bin/env python3
"""Mint a commercial license key for The Other Dude.

Run this when someone pays. It prints a key to paste into your reply, plus a
ready-made email body so issuing a license is copy, paste, send.

The signing key lives outside the repository (default ~/.tod-license/
signing_key.hex) and must never be committed or shared. The matching public
key is in backend/app/config.py as LICENSE_PUBLIC_KEY and ships with the app.

    tools/mint_license.py --name "Acme Networks" --devices 2000

Losing the signing key does not break already-issued keys — verification only
needs the public key — but you would be unable to issue new ones without
shipping a new public key. Back it up somewhere you trust.
"""

from __future__ import annotations

import argparse
import datetime
import pathlib
import secrets
import sys

# Import the shared key format so mint and verify can never drift apart.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import (  # noqa: E402
    Ed25519PrivateKey,
)

from app.license import build_payload, format_key, verify_license_key  # noqa: E402

DEFAULT_KEY_FILE = pathlib.Path.home() / ".tod-license" / "signing_key.hex"

EMAIL_TEMPLATE = """\
Subject: Your The Other Dude commercial license

Thanks for buying a license.

Your key is below. Paste it into the app under About > License, and the
device count will stop showing red.

{key}

Licensed to: {licensee}
Devices: {devices}
Issued: {issued}
License ID: {license_id}

This license is perpetual. It does not expire, it will not phone home, and
it will keep working on every future version.

It does not include direct support. Bugs and questions go to GitHub issues
like everyone else's, which is where I actually look:
https://github.com/staack/the-other-dude/issues

- Jason
"""


def load_signing_key(path: pathlib.Path) -> Ed25519PrivateKey:
    if not path.exists():
        raise SystemExit(
            f"No signing key at {path}\n"
            "Generate one with --init, then record the printed public key in "
            "backend/app/config.py as LICENSE_PUBLIC_KEY."
        )
    raw = bytes.fromhex(path.read_text().strip())
    return Ed25519PrivateKey.from_private_bytes(raw)


def public_key_hex(private_key: Ed25519PrivateKey) -> str:
    return (
        private_key.public_key()
        .public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        .hex()
    )


def init_signing_key(path: pathlib.Path) -> None:
    if path.exists():
        raise SystemExit(f"Refusing to overwrite existing signing key at {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    private_key = Ed25519PrivateKey.generate()
    raw = private_key.private_bytes(
        serialization.Encoding.Raw,
        serialization.PrivateFormat.Raw,
        serialization.NoEncryption(),
    )
    path.write_text(raw.hex())
    path.chmod(0o600)
    print(f"Signing key written to {path} (keep this secret, back it up)")
    print(f"Public key for backend/app/config.py:\n  {public_key_hex(private_key)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--name", help="Licensee name, shown in the app")
    parser.add_argument(
        "--devices", type=int, help="Device limit this key grants (e.g. 2000)"
    )
    parser.add_argument(
        "--unlimited",
        action="store_true",
        help="Issue an unlimited license (the normal commercial key)",
    )
    parser.add_argument("--id", help="License ID (default: auto-generated)")
    parser.add_argument(
        "--key-file",
        type=pathlib.Path,
        default=DEFAULT_KEY_FILE,
        help=f"Signing key path (default: {DEFAULT_KEY_FILE})",
    )
    parser.add_argument(
        "--init", action="store_true", help="Generate a new signing key and exit"
    )
    parser.add_argument(
        "--key-only", action="store_true", help="Print just the key, no email body"
    )
    args = parser.parse_args()

    if args.init:
        init_signing_key(args.key_file)
        return

    if not args.name:
        parser.error("--name is required (or use --init)")
    if args.unlimited and args.devices:
        parser.error("use either --unlimited or --devices, not both")
    if not args.unlimited and not args.devices:
        parser.error("pass --unlimited for a standard commercial key, or --devices N")
    if args.devices is not None and args.devices < 1:
        parser.error("--devices must be at least 1")

    devices = None if args.unlimited else args.devices

    private_key = load_signing_key(args.key_file)
    issued = datetime.date.today().isoformat()
    license_id = (
        args.id or f"TOD-{issued.replace('-', '')}-{secrets.token_hex(2).upper()}"
    )

    payload = build_payload(args.name, devices, issued, license_id)
    key = format_key(payload, private_key.sign(payload))

    # Never hand out a key without proving it verifies against the public key
    # the application will actually use.
    info = verify_license_key(key, public_key_hex(private_key))
    assert info.licensee == args.name and info.devices == devices

    if args.key_only:
        print(key)
        return

    print(
        EMAIL_TEMPLATE.format(
            key=key,
            licensee=info.licensee,
            devices="Unlimited" if info.is_unlimited else f"{info.devices:,}",
            issued=info.issued,
            license_id=info.license_id,
        )
    )


if __name__ == "__main__":
    main()
