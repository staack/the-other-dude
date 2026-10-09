#!/usr/bin/env python3
"""Add variables that a newer TOD release requires to an existing env file.

Run this before pulling a new version on an existing install:

    python3 scripts/upgrade_env.py            # updates .env.prod
    python3 scripts/upgrade_env.py .env       # or another file

For every required variable that is missing or empty, a generated value is
appended. Existing lines are never changed. A timestamped backup is written
next to the file before anything is modified. Safe to run repeatedly.
"""

from __future__ import annotations

import datetime
import os
import pathlib
import secrets
import sys

# Variable -> generator. Add an entry here whenever a release introduces a
# required variable, with the same generator setup.py uses.
REQUIRED: dict[str, callable] = {
    # 9.12.0: shared secret between the API and the WinBox worker control API.
    "WINBOX_WORKER_TOKEN": lambda: secrets.token_urlsafe(32),
}


def _present_values(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        name = name.strip()
        if name.startswith("export "):
            name = name[len("export ") :].strip()
        values[name] = _dotenv_value(value.strip())
    return values


def _dotenv_value(raw: str) -> str:
    """Interpret a value the way Compose does: a quoted string ends at its
    closing quote, an unquoted one at the first ` #` comment marker."""
    if raw[:1] in ("'", '"'):
        quote = raw[0]
        end = raw.find(quote, 1)
        return raw[1:end] if end != -1 else raw[1:]
    for marker in (" #", "\t#"):
        if marker in raw:
            raw = raw[: raw.index(marker)]
    return raw.strip()


def upgrade_env_file(path: pathlib.Path) -> list[str]:
    """Append missing required variables to ``path``; return the names added."""
    path = pathlib.Path(path)
    if not path.is_file():
        raise FileNotFoundError(
            f"{path} does not exist; run setup.py for a new install"
        )

    original = path.read_text()
    present = _present_values(original)
    missing = [name for name in REQUIRED if not present.get(name)]
    if not missing:
        return []

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = path.with_name(f"{path.name}.backup.{stamp}")
    # The backup carries the same secrets as the env file: create it
    # owner-only and refuse to clobber an existing file, whatever the umask.
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(original)
    os.chmod(backup, 0o600)

    lines = [original if original.endswith("\n") or not original else original + "\n"]
    lines.append(f"\n# Added by scripts/upgrade_env.py on {stamp}\n")
    for name in missing:
        lines.append(f"{name}={REQUIRED[name]()}\n")
    path.write_text("".join(lines))
    return missing


def main(argv: list[str]) -> int:
    target = pathlib.Path(argv[1]) if len(argv) > 1 else pathlib.Path(".env.prod")
    try:
        added = upgrade_env_file(target)
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if added:
        print(f"{target}: added {', '.join(added)} (backup written next to it)")
    else:
        print(f"{target}: nothing to add")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
