"""NATS JetStream subscriber for config snapshot ingestion from the Go poller.

Consumes config.snapshot.> messages, deduplicates by SHA256 hash,
encrypts config text via OpenBao Transit, and persists new snapshots
to the router_config_snapshots table.

Plaintext config is NEVER stored in PostgreSQL and NEVER logged.
"""

import asyncio
import json
import logging
import time
import uuid as _uuid
from datetime import datetime, timezone
from typing import Any, Optional

from prometheus_client import Counter, Histogram
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError

from app.config import settings
from app.database import AdminAsyncSessionLocal
from app.services.audit_service import log_action
from app.services.config_diff_service import generate_and_store_diff
from app.services.openbao_service import OpenBaoTransitService

logger = logging.getLogger(__name__)

# --- Prometheus metrics ---

config_snapshot_ingested_total = Counter(
    "config_snapshot_ingested_total",
    "Total config snapshots successfully ingested",
)
config_snapshot_dedup_skipped_total = Counter(
    "config_snapshot_dedup_skipped_total",
    "Total config snapshots skipped due to deduplication",
)
config_snapshot_errors_total = Counter(
    "config_snapshot_errors_total",
    "Total config snapshot ingestion errors",
    ["error_type"],
)
config_snapshot_ingestion_duration_seconds = Histogram(
    "config_snapshot_ingestion_duration_seconds",
    "Time to process a config snapshot message",
)

# --- Module state ---

_nc: Optional[Any] = None


async def handle_config_snapshot(msg) -> None:
    """Handle a config.snapshot.> message from the Go poller.

    1. Parse JSON payload; malformed -> ack + discard
    2. Dedup check against latest hash for device
    3. Encrypt via OpenBao Transit; failure -> nak (NATS retry)
    4. INSERT new RouterConfigSnapshot row
    5. FK violation (orphan device) -> ack + discard
    6. Transient DB error -> nak for retry
    """
    start_time = time.monotonic()
    try:
        data = json.loads(msg.data)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        logger.warning("Malformed config snapshot message (bad JSON): %s", exc)
        config_snapshot_errors_total.labels(error_type="malformed").inc()
        await msg.ack()
        return

    device_id = data.get("device_id")
    tenant_id = data.get("tenant_id")
    sha256_hash = data.get("sha256_hash")
    config_text = data.get("config_text")

    # Validate required fields
    if not device_id or not tenant_id or not sha256_hash or not config_text:
        logger.warning(
            "Config snapshot message missing required fields (device_id=%s, tenant_id=%s)",
            device_id,
            tenant_id,
        )
        config_snapshot_errors_total.labels(error_type="malformed").inc()
        await msg.ack()
        return

    collected_at_raw = data.get("collected_at")
    try:
        collected_at = datetime.fromisoformat(
            collected_at_raw.replace("Z", "+00:00")
        ) if collected_at_raw else datetime.now(timezone.utc)
    except (ValueError, AttributeError):
        collected_at = datetime.now(timezone.utc)

    async with AdminAsyncSessionLocal() as session:
        # --- Dedup check ---
        result = await session.execute(
            text(
                "SELECT sha256_hash FROM router_config_snapshots "
                "WHERE device_id = CAST(:device_id AS uuid) "
                "ORDER BY collected_at DESC LIMIT 1"
            ),
            {"device_id": device_id},
        )
        latest_hash = result.scalar_one_or_none()

        if latest_hash == sha256_hash:
            logger.debug(
                "Duplicate config snapshot skipped for device %s",
                device_id,
            )
            config_snapshot_dedup_skipped_total.inc()
            try:
                await log_action(
                    db=None,
                    tenant_id=_uuid.UUID(tenant_id),
                    user_id=None,
                    action="config_snapshot_skipped_duplicate",
                    resource_type="config_snapshot",
                    device_id=_uuid.UUID(device_id),
                    details={"sha256_hash": sha256_hash},
                )
            except Exception:
                pass
            await msg.ack()
            return

        # --- Encrypt via OpenBao Transit ---
        openbao = OpenBaoTransitService()
        try:
            encrypted_text = await openbao.encrypt(
                tenant_id, config_text.encode("utf-8")
            )
        except Exception as exc:
            logger.warning(
                "Transit encrypt failed for device %s tenant %s: %s",
                device_id,
                tenant_id,
                exc,
            )
            config_snapshot_errors_total.labels(error_type="encrypt_unavailable").inc()
            await msg.nak()
            return
        finally:
            await openbao.close()

        # --- INSERT new snapshot ---
        try:
            insert_result = await session.execute(
                text(
                    "INSERT INTO router_config_snapshots "
                    "(device_id, tenant_id, config_text, sha256_hash, collected_at) "
                    "VALUES (CAST(:device_id AS uuid), CAST(:tenant_id AS uuid), "
                    ":config_text, :sha256_hash, :collected_at) "
                    "RETURNING id"
                ),
                {
                    "device_id": device_id,
                    "tenant_id": tenant_id,
                    "config_text": encrypted_text,
                    "sha256_hash": sha256_hash,
                    "collected_at": collected_at,
                },
            )
            new_snapshot_id = insert_result.scalar_one()
            await session.commit()
        except IntegrityError:
            logger.warning(
                "Orphan device_id %s (FK constraint violation) — discarding snapshot",
                device_id,
            )
            config_snapshot_errors_total.labels(error_type="orphan_device").inc()
            await session.rollback()
            await msg.ack()
            return
        except OperationalError as exc:
            logger.warning(
                "Transient DB error storing snapshot for device %s: %s",
                device_id,
                exc,
            )
            config_snapshot_errors_total.labels(error_type="db_error").inc()
            await session.rollback()
            await msg.nak()
            return

        try:
            await log_action(
                db=None,
                tenant_id=_uuid.UUID(tenant_id),
                user_id=None,
                action="config_snapshot_created",
                resource_type="config_snapshot",
                resource_id=str(new_snapshot_id),
                device_id=_uuid.UUID(device_id),
                details={"sha256_hash": sha256_hash},
            )
        except Exception:
            pass

        # --- Diff generation (best-effort) ---
        try:
            await generate_and_store_diff(device_id, tenant_id, str(new_snapshot_id), session)
        except Exception as exc:
            logger.warning(
                "Diff generation failed for device %s (non-fatal): %s",
                device_id, exc,
            )

    logger.info(
        "Config snapshot stored for device %s tenant %s",
        device_id,
        tenant_id,
    )
    config_snapshot_ingested_total.inc()
    duration = time.monotonic() - start_time
    config_snapshot_ingestion_duration_seconds.observe(duration)
    await msg.ack()


async def _subscribe_with_retry(js) -> None:
    """Subscribe to config.snapshot.> with durable consumer, retrying if stream not ready."""
    max_attempts = 6
    for attempt in range(1, max_attempts + 1):
        try:
            await js.subscribe(
                "config.snapshot.>",
                cb=handle_config_snapshot,
                durable="config_snapshot_ingest",
                stream="DEVICE_EVENTS",
                manual_ack=True,
            )
            logger.info(
                "NATS: subscribed to config.snapshot.> (durable: config_snapshot_ingest)"
            )
            return
        except Exception as exc:
            if attempt < max_attempts:
                logger.warning(
                    "NATS: stream DEVICE_EVENTS not ready for config.snapshot (attempt %d/%d): %s — retrying in 5s",
                    attempt,
                    max_attempts,
                    exc,
                )
                await asyncio.sleep(5)
            else:
                logger.warning(
                    "NATS: giving up on config.snapshot.> after %d attempts: %s",
                    max_attempts,
                    exc,
                )
                return


async def start_config_snapshot_subscriber() -> Optional[Any]:
    """Connect to NATS and start the config.snapshot.> subscription.

    Returns the NATS connection for shutdown management.
    """
    import nats

    global _nc

    logger.info("NATS config-snapshot: connecting to %s", settings.NATS_URL)
    _nc = await nats.connect(
        settings.NATS_URL,
        max_reconnect_attempts=-1,
        reconnect_time_wait=2,
    )
    logger.info("NATS config-snapshot: connected")

    js = _nc.jetstream()
    await _subscribe_with_retry(js)

    return _nc


async def stop_config_snapshot_subscriber() -> None:
    """Drain and close the NATS connection gracefully."""
    global _nc
    if _nc:
        try:
            logger.info("NATS config-snapshot: draining connection...")
            await _nc.drain()
            logger.info("NATS config-snapshot: connection closed")
        except Exception as exc:
            logger.warning("NATS config-snapshot: error during drain: %s", exc)
            try:
                await _nc.close()
            except Exception:
                pass
        finally:
            _nc = None
