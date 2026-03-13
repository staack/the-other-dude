"""Config diff generation service.

Generates unified diffs between consecutive router config snapshots.
Called after a new non-duplicate snapshot is stored. Best-effort:
errors are logged and counted via Prometheus, never raised.

Plaintext config is decrypted via OpenBao Transit, diffed in-memory,
and the diff text is stored in router_config_diffs. Plaintext is
never persisted or logged.
"""

import difflib
import logging
import time

from prometheus_client import Counter, Histogram
from sqlalchemy import text

from app.services.config_change_parser import parse_diff_changes
from app.services.openbao_service import OpenBaoTransitService

logger = logging.getLogger(__name__)

# --- Prometheus metrics ---

config_diff_generated_total = Counter(
    "config_diff_generated_total",
    "Total successful diff generations",
)
config_diff_errors_total = Counter(
    "config_diff_errors_total",
    "Total diff generation errors",
    ["error_type"],
)
config_diff_generation_duration_seconds = Histogram(
    "config_diff_generation_duration_seconds",
    "Time to generate a config diff",
)


async def generate_and_store_diff(
    device_id: str,
    tenant_id: str,
    new_snapshot_id: str,
    session,
) -> None:
    """Generate unified diff between new snapshot and previous, store in router_config_diffs.

    Best-effort: errors are logged and counted, never raised.
    Called from handle_config_snapshot after successful INSERT.
    """
    start_time = time.monotonic()
    try:
        # 1. Query previous snapshot
        result = await session.execute(
            text(
                "SELECT id, config_text FROM router_config_snapshots "
                "WHERE device_id = CAST(:device_id AS uuid) "
                "AND id != CAST(:new_snapshot_id AS uuid) "
                "ORDER BY collected_at DESC LIMIT 1"
            ),
            {"device_id": device_id, "new_snapshot_id": new_snapshot_id},
        )
        prev_row = result.fetchone()

        # 2. No previous snapshot = first snapshot for device
        if prev_row is None:
            logger.debug(
                "First snapshot for device %s, no diff to generate", device_id
            )
            return

        old_snapshot_id = prev_row._mapping["id"]
        old_ciphertext = prev_row._mapping["config_text"]

        # 3. Query new snapshot config_text
        new_result = await session.execute(
            text(
                "SELECT config_text FROM router_config_snapshots "
                "WHERE id = CAST(:new_snapshot_id AS uuid)"
            ),
            {"new_snapshot_id": new_snapshot_id},
        )
        new_ciphertext = new_result.scalar_one()

        # 4. Decrypt both via OpenBao Transit
        openbao = OpenBaoTransitService()
        try:
            old_plaintext = await openbao.decrypt(tenant_id, old_ciphertext)
            new_plaintext = await openbao.decrypt(tenant_id, new_ciphertext)
        except Exception as exc:
            # 5. Decrypt failure: log warning, increment counter, return
            logger.warning(
                "Transit decrypt failed for diff (device %s): %s",
                device_id,
                exc,
            )
            config_diff_errors_total.labels(error_type="decrypt_failed").inc()
            return
        finally:
            await openbao.close()

        # 6. Generate unified diff
        old_lines = old_plaintext.decode("utf-8").splitlines()
        new_lines = new_plaintext.decode("utf-8").splitlines()
        diff_lines = list(
            difflib.unified_diff(old_lines, new_lines, lineterm="", n=3)
        )

        # 7. If empty diff, skip INSERT
        diff_text = "\n".join(diff_lines)
        if not diff_text:
            logger.debug(
                "Empty diff for device %s (identical content), skipping",
                device_id,
            )
            return

        # 8. Count lines added/removed (exclude +++ and --- headers)
        lines_added = sum(
            1 for line in diff_lines
            if line.startswith("+") and not line.startswith("++")
        )
        lines_removed = sum(
            1 for line in diff_lines
            if line.startswith("-") and not line.startswith("--")
        )

        # 9. INSERT into router_config_diffs (RETURNING id for change parser)
        diff_result = await session.execute(
            text(
                "INSERT INTO router_config_diffs "
                "(device_id, tenant_id, old_snapshot_id, new_snapshot_id, "
                "diff_text, lines_added, lines_removed) "
                "VALUES (CAST(:device_id AS uuid), CAST(:tenant_id AS uuid), "
                "CAST(:old_snapshot_id AS uuid), CAST(:new_snapshot_id AS uuid), "
                ":diff_text, :lines_added, :lines_removed) "
                "RETURNING id"
            ),
            {
                "device_id": device_id,
                "tenant_id": tenant_id,
                "old_snapshot_id": str(old_snapshot_id),
                "new_snapshot_id": new_snapshot_id,
                "diff_text": diff_text,
                "lines_added": lines_added,
                "lines_removed": lines_removed,
            },
        )
        diff_id = diff_result.scalar_one()

        # 10. Commit diff
        await session.commit()

        config_diff_generated_total.inc()
        duration = time.monotonic() - start_time
        config_diff_generation_duration_seconds.observe(duration)
        logger.info(
            "Config diff generated for device %s: +%d/-%d lines",
            device_id,
            lines_added,
            lines_removed,
        )

        try:
            from app.services.audit_service import log_action
            import uuid as _uuid
            await log_action(
                db=None,
                tenant_id=_uuid.UUID(tenant_id),
                user_id=None,
                action="config_diff_generated",
                resource_type="config_diff",
                resource_id=str(diff_id),
                device_id=_uuid.UUID(device_id),
                details={
                    "old_snapshot_id": str(old_snapshot_id),
                    "new_snapshot_id": new_snapshot_id,
                    "lines_added": lines_added,
                    "lines_removed": lines_removed,
                },
            )
        except Exception:
            pass

        # 11. Parse structured changes (best-effort)
        try:
            changes = parse_diff_changes(diff_text)
            for change in changes:
                await session.execute(
                    text(
                        "INSERT INTO router_config_changes "
                        "(diff_id, device_id, tenant_id, component, summary, raw_line) "
                        "VALUES (CAST(:diff_id AS uuid), CAST(:device_id AS uuid), "
                        "CAST(:tenant_id AS uuid), :component, :summary, :raw_line)"
                    ),
                    {
                        "diff_id": str(diff_id),
                        "device_id": device_id,
                        "tenant_id": tenant_id,
                        "component": change["component"],
                        "summary": change["summary"],
                        "raw_line": change["raw_line"],
                    },
                )
            if changes:
                await session.commit()
                logger.info(
                    "Stored %d config changes for device %s diff %s",
                    len(changes), device_id, diff_id,
                )
        except Exception as exc:
            logger.warning(
                "Change parser error for device %s diff %s (non-fatal): %s",
                device_id, diff_id, exc,
            )
            config_diff_errors_total.labels(error_type="change_parser").inc()

    except Exception as exc:
        logger.warning(
            "Diff generation error for device %s (non-fatal): %s",
            device_id,
            exc,
        )
        config_diff_errors_total.labels(error_type="db_error").inc()
