"""RouterOS RSC export parser — extracts categories, validates syntax, computes impact."""

import re
import logging
from typing import Any

logger = logging.getLogger(__name__)

HIGH_RISK_PATHS = {
    "/ip address", "/ip route", "/ip firewall filter", "/ip firewall nat",
    "/interface", "/interface bridge", "/interface vlan",
    "/system identity", "/ip service", "/ip ssh", "/user",
}

MANAGEMENT_PATTERNS = [
    (re.compile(r"chain=input.*dst-port=(22|8291|8728|8729|443|80)", re.I),
     "Modifies firewall rules for management ports (SSH/WinBox/API/Web)"),
    (re.compile(r"chain=input.*action=drop", re.I),
     "Adds drop rule on input chain — may block management access"),
    (re.compile(r"/ip service", re.I),
     "Modifies IP services — may disable API/SSH/WinBox access"),
    (re.compile(r"/user.*set.*password", re.I),
     "Changes user password — may affect automated access"),
]


def _join_continuation_lines(text: str) -> list[str]:
    """Join lines ending with \\ into single logical lines."""
    lines = text.split("\n")
    joined: list[str] = []
    buf = ""
    for line in lines:
        stripped = line.rstrip()
        if stripped.endswith("\\"):
            buf += stripped[:-1].rstrip() + " "
        else:
            if buf:
                buf += stripped
                joined.append(buf)
                buf = ""
            else:
                joined.append(stripped)
    if buf:
        joined.append(buf + " <<TRUNCATED>>")
    return joined


def parse_rsc(text: str) -> dict[str, Any]:
    """Parse a RouterOS /export compact output.

    Returns a dict with a "categories" list, each containing:
    - path: the RouterOS command path (e.g. "/ip address")
    - adds: count of "add" commands
    - sets: count of "set" commands
    - removes: count of "remove" commands
    - commands: list of command strings under this path
    """
    lines = _join_continuation_lines(text)
    categories: dict[str, dict] = {}
    current_path: str | None = None

    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        if line.startswith("/"):
            # Could be just a path header, or a path followed by a command
            parts = line.split(None, 1)
            if len(parts) == 1:
                # Pure path header like "/interface bridge"
                current_path = parts[0]
            else:
                # Check if second part starts with a known command verb
                cmd_check = parts[1].strip().split(None, 1)
                if cmd_check and cmd_check[0] in ("add", "set", "remove", "print", "enable", "disable"):
                    current_path = parts[0]
                    line = parts[1].strip()
                else:
                    # The whole line is a path (e.g. "/ip firewall filter")
                    current_path = line
                    continue

            if current_path and current_path not in categories:
                categories[current_path] = {
                    "path": current_path,
                    "adds": 0,
                    "sets": 0,
                    "removes": 0,
                    "commands": [],
                }

            if len(parts) == 1:
                continue

        if current_path is None:
            continue

        if current_path not in categories:
            categories[current_path] = {
                "path": current_path,
                "adds": 0,
                "sets": 0,
                "removes": 0,
                "commands": [],
            }

        cat = categories[current_path]
        cat["commands"].append(line)

        if line.startswith("add ") or line.startswith("add\t"):
            cat["adds"] += 1
        elif line.startswith("set "):
            cat["sets"] += 1
        elif line.startswith("remove "):
            cat["removes"] += 1

    return {"categories": list(categories.values())}


def validate_rsc(text: str) -> dict[str, Any]:
    """Validate RSC export syntax.

    Checks for:
    - Unbalanced quotes (indicates truncation or corruption)
    - Trailing continuation lines (indicates truncated export)

    Returns dict with "valid" (bool) and "errors" (list of strings).
    """
    errors: list[str] = []

    # Check for unbalanced quotes across the entire file
    in_quote = False
    for line in text.split("\n"):
        stripped = line.rstrip()
        if stripped.endswith("\\"):
            stripped = stripped[:-1]
        # Count unescaped quotes
        count = stripped.count('"') - stripped.count('\\"')
        if count % 2 != 0:
            in_quote = not in_quote

    if in_quote:
        errors.append("Unbalanced quote detected — file may be truncated")

    # Check if file ends with a continuation backslash
    lines = text.rstrip().split("\n")
    if lines and lines[-1].rstrip().endswith("\\"):
        errors.append("File ends with continuation line (\\) — truncated export")

    return {"valid": len(errors) == 0, "errors": errors}


def compute_impact(
    current_parsed: dict[str, Any],
    target_parsed: dict[str, Any],
) -> dict[str, Any]:
    """Compare current vs target parsed RSC and compute impact analysis.

    Returns dict with:
    - categories: list of per-path diffs with risk levels
    - warnings: list of human-readable warning strings
    - diff: summary counts (added, removed, modified)
    """
    current_map = {c["path"]: c for c in current_parsed["categories"]}
    target_map = {c["path"]: c for c in target_parsed["categories"]}
    all_paths = sorted(set(list(current_map.keys()) + list(target_map.keys())))

    result_categories = []
    warnings: list[str] = []
    total_added = total_removed = total_modified = 0

    for path in all_paths:
        curr = current_map.get(path, {"adds": 0, "sets": 0, "removes": 0, "commands": []})
        tgt = target_map.get(path, {"adds": 0, "sets": 0, "removes": 0, "commands": []})
        curr_cmds = set(curr.get("commands", []))
        tgt_cmds = set(tgt.get("commands", []))
        added = len(tgt_cmds - curr_cmds)
        removed = len(curr_cmds - tgt_cmds)
        total_added += added
        total_removed += removed

        has_changes = added > 0 or removed > 0
        risk = "none"
        if has_changes:
            risk = "high" if path in HIGH_RISK_PATHS else "low"
        result_categories.append({
            "path": path,
            "adds": added,
            "removes": removed,
            "risk": risk,
        })

    # Check target commands against management patterns
    target_text = "\n".join(
        cmd for cat in target_parsed["categories"] for cmd in cat.get("commands", [])
    )
    for pattern, message in MANAGEMENT_PATTERNS:
        if pattern.search(target_text):
            warnings.append(message)

    # Warn about removed IP addresses
    if "/ip address" in current_map and "/ip address" in target_map:
        curr_addrs = current_map["/ip address"].get("commands", [])
        tgt_addrs = target_map["/ip address"].get("commands", [])
        removed_addrs = set(curr_addrs) - set(tgt_addrs)
        if removed_addrs:
            warnings.append(
                f"Removes {len(removed_addrs)} IP address(es) — verify none are management interfaces"
            )

    return {
        "categories": result_categories,
        "warnings": warnings,
        "diff": {
            "added": total_added,
            "removed": total_removed,
            "modified": total_modified,
        },
    }
