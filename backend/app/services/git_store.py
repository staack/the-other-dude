"""pygit2-based git store for versioned config backup storage.

All functions in this module are synchronous (pygit2 is C bindings over libgit2).
Callers running in an async context MUST wrap calls in:
    loop.run_in_executor(None, func, *args)
or:
    asyncio.get_event_loop().run_in_executor(None, func, *args)

See Pitfall 3 in 04-RESEARCH.md — blocking pygit2 in async context stalls
the event loop and causes timeouts for other concurrent requests.

Git layout:
    {GIT_STORE_PATH}/{tenant_id}.git/   <- bare repo per tenant
        objects/ refs/ HEAD              <- standard bare git structure
        {device_id}/                     <- device subtree
            export.rsc                   <- text export (/export compact)
            backup.bin                   <- binary system backup
"""

import difflib
import threading
from pathlib import Path
from typing import Optional

import pygit2

from app.config import settings

# =========================================================================
# Per-tenant mutex to prevent TreeBuilder race condition (Pitfall 5 in RESEARCH.md).
# Two simultaneous backups for different devices in the same tenant repo would
# each read HEAD, build their own device subtrees, and write conflicting root
# trees. The second commit would lose the first's device subtree.
# Lock scope is the entire tenant repo — not just the device.
# =========================================================================
_tenant_locks: dict[str, threading.Lock] = {}
_tenant_locks_guard = threading.Lock()


def _get_tenant_lock(tenant_id: str) -> threading.Lock:
    """Return (creating if needed) the per-tenant commit lock."""
    with _tenant_locks_guard:
        if tenant_id not in _tenant_locks:
            _tenant_locks[tenant_id] = threading.Lock()
        return _tenant_locks[tenant_id]


# =========================================================================
# PUBLIC API
# =========================================================================


def get_or_create_repo(tenant_id: str) -> pygit2.Repository:
    """Open the tenant's bare git repo, creating it on first use.

    The repo lives at {GIT_STORE_PATH}/{tenant_id}.git. The parent directory
    is created if it does not exist.

    Args:
        tenant_id: Tenant UUID as string.

    Returns:
        An open pygit2.Repository instance (bare).
    """
    git_store_root = Path(settings.GIT_STORE_PATH)
    git_store_root.mkdir(parents=True, exist_ok=True)

    repo_path = git_store_root / f"{tenant_id}.git"
    if repo_path.exists():
        return pygit2.Repository(str(repo_path))

    return pygit2.init_repository(str(repo_path), bare=True)


def commit_backup(
    tenant_id: str,
    device_id: str,
    export_text: str,
    binary_backup: bytes,
    message: str,
) -> str:
    """Write a backup pair (export.rsc + backup.bin) as a git commit.

    Creates or updates the device subdirectory in the tenant's bare repo.
    Preserves other devices' subdirectories by merging the device subtree
    into the existing root tree.

    Per-tenant locking (threading.Lock) prevents the TreeBuilder race
    condition when two devices in the same tenant back up concurrently.

    Args:
        tenant_id:      Tenant UUID as string.
        device_id:      Device UUID as string (becomes a subdirectory in the repo).
        export_text:    Text output of /export compact.
        binary_backup:  Raw bytes from /system backup save.
        message:        Commit message (format: "{trigger}: {hostname} ({ip}) at {ts}").

    Returns:
        The hex commit SHA string (40 characters).
    """
    lock = _get_tenant_lock(tenant_id)

    with lock:
        repo = get_or_create_repo(tenant_id)

        # Create blobs from content
        export_oid = repo.create_blob(export_text.encode("utf-8"))
        binary_oid = repo.create_blob(binary_backup)

        # Build device subtree: {device_id}/export.rsc and {device_id}/backup.bin
        device_builder = repo.TreeBuilder()
        device_builder.insert("export.rsc", export_oid, pygit2.GIT_FILEMODE_BLOB)
        device_builder.insert("backup.bin", binary_oid, pygit2.GIT_FILEMODE_BLOB)
        device_tree_oid = device_builder.write()

        # Merge device subtree into root tree, preserving all other device subtrees.
        # If the repo has no commits yet, start with an empty root tree.
        root_ref = repo.references.get("refs/heads/main")
        parent_commit: Optional[pygit2.Commit] = None

        if root_ref is not None:
            try:
                parent_commit = repo.get(root_ref.target)
                root_builder = repo.TreeBuilder(parent_commit.tree)
            except Exception:
                root_builder = repo.TreeBuilder()
        else:
            root_builder = repo.TreeBuilder()

        root_builder.insert(device_id, device_tree_oid, pygit2.GIT_FILEMODE_TREE)
        root_tree_oid = root_builder.write()

        # Author signature — no real identity, portal service account
        author = pygit2.Signature("The Other Dude", "backup@tod.local")

        parents = [root_ref.target] if root_ref is not None else []

        commit_oid = repo.create_commit(
            "refs/heads/main",
            author,
            author,
            message,
            root_tree_oid,
            parents,
        )

        return str(commit_oid)


def read_file(
    tenant_id: str,
    commit_sha: str,
    device_id: str,
    filename: str,
) -> bytes:
    """Read a file blob from a specific backup commit.

    Navigates the tree: root -> device_id subtree -> filename.

    Args:
        tenant_id:   Tenant UUID as string.
        commit_sha:  Full or abbreviated git commit SHA.
        device_id:   Device UUID as string (subdirectory name in the repo).
        filename:    File to read: "export.rsc" or "backup.bin".

    Returns:
        Raw bytes of the file content.

    Raises:
        KeyError:     If device_id subtree or filename does not exist in commit.
        pygit2.GitError: If commit_sha is not found.
    """
    repo = get_or_create_repo(tenant_id)

    commit_obj = repo.get(commit_sha)
    if commit_obj is None:
        raise KeyError(f"Commit {commit_sha!r} not found in tenant {tenant_id!r} repo")

    # Navigate: root tree -> device subtree -> file blob
    device_entry = commit_obj.tree[device_id]
    device_tree = repo.get(device_entry.id)
    file_entry = device_tree[filename]
    file_blob = repo.get(file_entry.id)

    return file_blob.data


def list_device_commits(
    tenant_id: str,
    device_id: str,
) -> list[dict]:
    """Walk commit history and return commits that include the device subtree.

    Walks commits newest-first. Returns only commits where the device_id
    subtree is present in the root tree (the device had a backup in that commit).

    Args:
        tenant_id:  Tenant UUID as string.
        device_id:  Device UUID as string.

    Returns:
        List of dicts (newest first):
            [{"sha": str, "message": str, "timestamp": int}, ...]
        Empty list if no commits or device has never been backed up.
    """
    repo = get_or_create_repo(tenant_id)

    # If there are no commits, return empty list immediately.
    # Use refs/heads/main explicitly rather than repo.head (which defaults to
    # refs/heads/master — wrong when the repo uses 'main' as the default branch).
    main_ref = repo.references.get("refs/heads/main")
    if main_ref is None:
        return []
    head_target = main_ref.target

    results = []
    walker = repo.walk(head_target, pygit2.GIT_SORT_TIME)

    for commit in walker:
        # Check if device_id subtree exists in this commit's root tree.
        try:
            device_entry = commit.tree[device_id]
        except KeyError:
            # Device not present in this commit at all — skip.
            continue

        # Only include this commit if it actually changed the device's subtree
        # vs its parent. This prevents every subsequent backup (for any device
        # in the same tenant) from appearing in all devices' histories.
        if commit.parents:
            parent = commit.parents[0]
            try:
                parent_device_entry = parent.tree[device_id]
                if parent_device_entry.id == device_entry.id:
                    # Device subtree unchanged in this commit — skip.
                    continue
            except KeyError:
                # Device wasn't in parent but is in this commit — it's the first entry.
                pass

        results.append({
            "sha": str(commit.id),
            "message": commit.message.strip(),
            "timestamp": commit.commit_time,
        })

    return results


def compute_line_delta(old_text: str, new_text: str) -> tuple[int, int]:
    """Compute (lines_added, lines_removed) between two text versions.

    Uses difflib.SequenceMatcher to efficiently compute the line-count delta
    without generating a full unified diff. This is faster than
    difflib.unified_diff for large config files.

    For the first backup (no prior version), pass old_text="" to get
    (total_lines, 0) as the delta.

    Args:
        old_text:  Previous export.rsc content (empty string for first backup).
        new_text:  New export.rsc content.

    Returns:
        Tuple of (lines_added, lines_removed).
    """
    old_lines = old_text.splitlines() if old_text else []
    new_lines = new_text.splitlines() if new_text else []

    if not old_lines and not new_lines:
        return (0, 0)

    # For first backup (empty old), all lines are "added".
    if not old_lines:
        return (len(new_lines), 0)

    # For deletion of all content, all lines are "removed".
    if not new_lines:
        return (0, len(old_lines))

    matcher = difflib.SequenceMatcher(None, old_lines, new_lines, autojunk=False)

    lines_added = 0
    lines_removed = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "replace":
            lines_removed += i2 - i1
            lines_added += j2 - j1
        elif tag == "delete":
            lines_removed += i2 - i1
        elif tag == "insert":
            lines_added += j2 - j1
        # "equal" — no change

    return (lines_added, lines_removed)
