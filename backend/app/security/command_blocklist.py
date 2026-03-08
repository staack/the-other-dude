"""Dangerous RouterOS command and path blocklist.

Prevents destructive or sensitive operations from being executed through
the config editor. Commands and paths are checked via case-insensitive
prefix matching against known-dangerous entries.

To extend: add strings to DANGEROUS_COMMANDS, BROWSE_BLOCKED_PATHS,
or WRITE_BLOCKED_PATHS.
"""

from fastapi import HTTPException, status

# CLI commands blocked from the execute endpoint.
# Matched as case-insensitive prefixes (e.g., "/user" blocks "/user/print" too).
DANGEROUS_COMMANDS: list[str] = [
    "/system/reset-configuration",
    "/system/shutdown",
    "/system/reboot",
    "/system/backup",
    "/system/license",
    "/user",
    "/password",
    "/certificate",
    "/radius",
    "/export",
    "/import",
]

# Paths blocked from ALL operations including browse (truly dangerous to read).
BROWSE_BLOCKED_PATHS: list[str] = [
    "system/reset-configuration",
    "system/shutdown",
    "system/reboot",
    "system/backup",
    "system/license",
    "password",
]

# Paths blocked from write operations (add/set/remove) but readable via browse.
WRITE_BLOCKED_PATHS: list[str] = [
    "user",
    "certificate",
    "radius",
]


def check_command_safety(command: str) -> None:
    """Reject dangerous CLI commands with HTTP 403.

    Normalizes the command (strip + lowercase) and checks against
    DANGEROUS_COMMANDS using prefix matching.

    Raises:
        HTTPException: 403 if the command matches a dangerous prefix.
    """
    normalized = command.strip().lower()
    for blocked in DANGEROUS_COMMANDS:
        if normalized.startswith(blocked):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Command blocked: '{command}' matches dangerous prefix '{blocked}'. "
                    f"This operation is not allowed through the config editor."
                ),
            )


def check_path_safety(path: str, *, write: bool = False) -> None:
    """Reject dangerous menu paths with HTTP 403.

    Normalizes the path (strip + lowercase + lstrip '/') and checks
    against blocked path lists using prefix matching.

    Args:
        path: The RouterOS menu path to check.
        write: If True, also check WRITE_BLOCKED_PATHS (for add/set/remove).
               If False, only check BROWSE_BLOCKED_PATHS (for read-only browse).

    Raises:
        HTTPException: 403 if the path matches a blocked prefix.
    """
    normalized = path.strip().lower().lstrip("/")
    blocked_lists = [BROWSE_BLOCKED_PATHS]
    if write:
        blocked_lists.append(WRITE_BLOCKED_PATHS)
    for blocklist in blocked_lists:
        for blocked in blocklist:
            if normalized.startswith(blocked):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        f"Path blocked: '{path}' matches dangerous prefix '{blocked}'. "
                        f"This operation is not allowed through the config editor."
                    ),
                )
