"""Structured change parser for RouterOS unified diffs.

Extracts component names and human-readable summaries from unified diffs
of RouterOS configurations. Each distinct RouterOS section in the diff
produces one change entry with component path, summary, and raw diff lines.
"""

from __future__ import annotations

import re
from collections import defaultdict


def _path_to_component(path: str) -> str:
    """Convert RouterOS path to component format.

    '/ip firewall filter' -> 'ip/firewall/filter'
    """
    return path.strip().lstrip("/").replace(" ", "/")


def _component_label(component: str) -> str:
    """Extract human-readable label from component path.

    'ip/firewall/filter' -> 'firewall filter'
    Last two segments joined with space, or last segment if only one.
    """
    parts = component.split("/")
    if len(parts) >= 2:
        return " ".join(parts[-2:])
    return parts[-1]


def _make_summary(adds: int, removes: int, component: str) -> str:
    """Generate human-readable summary for a component's changes."""
    label = _component_label(component)
    if adds > 0 and removes > 0:
        n = max(adds, removes)
        noun = "rule" if n == 1 else "rules"
        return f"Modified {n} {label} {noun}"
    elif adds > 0:
        noun = "rule" if adds == 1 else "rules"
        return f"Added {adds} {label} {noun}"
    else:
        noun = "rule" if removes == 1 else "rules"
        return f"Removed {removes} {label} {noun}"


_ROUTEROS_PATH_RE = re.compile(r"^(/[a-z][a-z0-9 /\-]*)", re.IGNORECASE)

FALLBACK_COMPONENT = "system/general"


def parse_diff_changes(diff_text: str) -> list[dict]:
    """Parse a unified diff of RouterOS config into structured changes.

    Returns list of dicts sorted by component, one per distinct component:
        {"component": "ip/firewall/filter",
         "summary": "Added 2 firewall filter rules",
         "raw_line": "+add chain=..."}
    """
    lines = diff_text.splitlines()

    current_section: str | None = None

    # Track per-component: adds, removes, raw_lines
    components: dict[str, dict] = defaultdict(
        lambda: {"adds": 0, "removes": 0, "raw_lines": []}
    )

    for line in lines:
        # Skip unified diff headers
        if line.startswith("---") or line.startswith("+++") or line.startswith("@@"):
            continue

        # Determine the raw content (strip the diff prefix for path detection)
        if line.startswith("+") or line.startswith("-"):
            content = line[1:]
            is_change = True
            is_add = line.startswith("+")
        elif line.startswith(" "):
            content = line[1:]
            is_change = False
            is_add = False
        else:
            content = line
            is_change = False
            is_add = False

        # Check if content contains a RouterOS path header
        path_match = _ROUTEROS_PATH_RE.match(content.strip())
        if path_match:
            candidate = path_match.group(1).strip()
            # Must have at least 2 chars after / to be a real path
            if len(candidate) > 1:
                current_section = _path_to_component(candidate)

        # Record changed lines
        if is_change:
            section = current_section or FALLBACK_COMPONENT
            components[section]["raw_lines"].append(line)
            if is_add:
                components[section]["adds"] += 1
            else:
                components[section]["removes"] += 1

    # Build result list
    result = []
    for component in sorted(components.keys()):
        data = components[component]
        if data["adds"] == 0 and data["removes"] == 0:
            continue
        result.append(
            {
                "component": component,
                "summary": _make_summary(data["adds"], data["removes"], component),
                "raw_line": "\n".join(data["raw_lines"]),
            }
        )

    return result
