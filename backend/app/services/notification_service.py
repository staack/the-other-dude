"""Email and webhook notification delivery for alert events.

Best-effort delivery: failures are logged but never raised.
Each dispatch is wrapped in try/except so one failing channel
doesn't prevent delivery to other channels.
"""

import logging
from typing import Any

import httpx


logger = logging.getLogger(__name__)


async def dispatch_notifications(
    alert_event: dict[str, Any],
    channels: list[dict[str, Any]],
    device_hostname: str,
) -> None:
    """Send notifications for an alert event to all provided channels.

    Args:
        alert_event: Dict with alert event fields (status, severity, metric, etc.)
        channels: List of notification channel dicts
        device_hostname: Human-readable device name for messages
    """
    for channel in channels:
        try:
            if channel["channel_type"] == "email":
                await _send_email(channel, alert_event, device_hostname)
            elif channel["channel_type"] == "webhook":
                await _send_webhook(channel, alert_event, device_hostname)
            elif channel["channel_type"] == "slack":
                await _send_slack(channel, alert_event, device_hostname)
            else:
                logger.warning("Unknown channel type: %s", channel["channel_type"])
        except Exception as e:
            logger.warning(
                "Notification delivery failed for channel %s (%s): %s",
                channel.get("name"), channel.get("channel_type"), e,
            )


async def _send_email(channel: dict, alert_event: dict, device_hostname: str) -> None:
    """Send alert notification email using per-channel SMTP config."""
    from app.services.email_service import SMTPConfig, send_email

    severity = alert_event.get("severity", "warning")
    status = alert_event.get("status", "firing")
    rule_name = alert_event.get("rule_name") or alert_event.get("message", "Unknown Rule")
    metric = alert_event.get("metric_name") or alert_event.get("metric", "")
    value = alert_event.get("current_value") or alert_event.get("value", "")
    threshold = alert_event.get("threshold", "")

    severity_colors = {
        "critical": "#ef4444",
        "warning": "#f59e0b",
        "info": "#38bdf8",
    }
    color = severity_colors.get(severity, "#38bdf8")
    status_label = "RESOLVED" if status == "resolved" else "FIRING"

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: {color}; padding: 16px 24px; border-radius: 8px 8px 0 0;">
            <h2 style="color: #fff; margin: 0;">[{status_label}] {rule_name}</h2>
        </div>
        <div style="background: #1e293b; padding: 24px; border-radius: 0 0 8px 8px; color: #e2e8f0;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px 0; color: #94a3b8;">Device</td><td style="padding: 8px 0;">{device_hostname}</td></tr>
                <tr><td style="padding: 8px 0; color: #94a3b8;">Severity</td><td style="padding: 8px 0;">{severity.upper()}</td></tr>
                <tr><td style="padding: 8px 0; color: #94a3b8;">Metric</td><td style="padding: 8px 0;">{metric}</td></tr>
                <tr><td style="padding: 8px 0; color: #94a3b8;">Value</td><td style="padding: 8px 0;">{value}</td></tr>
                <tr><td style="padding: 8px 0; color: #94a3b8;">Threshold</td><td style="padding: 8px 0;">{threshold}</td></tr>
            </table>
            <p style="color: #64748b; font-size: 12px; margin-top: 24px;">
                TOD — Fleet Management for MikroTik RouterOS
            </p>
        </div>
    </div>
    """

    plain = (
        f"[{status_label}] {rule_name}\n\n"
        f"Device: {device_hostname}\n"
        f"Severity: {severity}\n"
        f"Metric: {metric}\n"
        f"Value: {value}\n"
        f"Threshold: {threshold}\n"
    )

    # Decrypt SMTP password (Transit first, then legacy Fernet)
    smtp_password = None
    transit_cipher = channel.get("smtp_password_transit")
    legacy_cipher = channel.get("smtp_password")
    tenant_id = channel.get("tenant_id")

    if transit_cipher and tenant_id:
        try:
            from app.services.kms_service import decrypt_transit
            smtp_password = await decrypt_transit(transit_cipher, tenant_id)
        except Exception:
            logger.warning("Transit decryption failed for channel %s, trying legacy", channel.get("id"))

    if not smtp_password and legacy_cipher:
        try:
            from app.config import settings as app_settings
            from cryptography.fernet import Fernet
            raw = bytes(legacy_cipher) if isinstance(legacy_cipher, memoryview) else legacy_cipher
            f = Fernet(app_settings.CREDENTIAL_ENCRYPTION_KEY.encode())
            smtp_password = f.decrypt(raw).decode()
        except Exception:
            logger.warning("Legacy decryption failed for channel %s", channel.get("id"))

    config = SMTPConfig(
        host=channel.get("smtp_host", "localhost"),
        port=channel.get("smtp_port", 587),
        user=channel.get("smtp_user"),
        password=smtp_password,
        use_tls=channel.get("smtp_use_tls", False),
        from_address=channel.get("from_address") or "alerts@the-other-dude.local",
    )

    to = channel.get("to_address")
    subject = f"[TOD {status_label}] {rule_name} — {device_hostname}"
    await send_email(to, subject, html, plain, config)


async def _send_webhook(
    channel: dict[str, Any],
    alert_event: dict[str, Any],
    device_hostname: str,
) -> None:
    """Send alert notification to a webhook URL (Slack-compatible JSON)."""
    severity = alert_event.get("severity", "info")
    status = alert_event.get("status", "firing")
    metric = alert_event.get("metric")
    value = alert_event.get("value")
    threshold = alert_event.get("threshold")
    message_text = alert_event.get("message", "")

    payload = {
        "alert_name": message_text,
        "severity": severity,
        "status": status,
        "device": device_hostname,
        "device_id": alert_event.get("device_id"),
        "metric": metric,
        "value": value,
        "threshold": threshold,
        "timestamp": str(alert_event.get("fired_at", "")),
        "text": f"[{severity.upper()}] {device_hostname}: {message_text}",
    }

    webhook_url = channel.get("webhook_url", "")
    if not webhook_url:
        logger.warning("Webhook channel %s has no URL configured", channel.get("name"))
        return

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(webhook_url, json=payload)
        logger.info(
            "Webhook notification sent to %s — status %d",
            webhook_url, response.status_code,
        )


async def _send_slack(
    channel: dict[str, Any],
    alert_event: dict[str, Any],
    device_hostname: str,
) -> None:
    """Send alert notification to Slack via incoming webhook with Block Kit formatting."""
    severity = alert_event.get("severity", "info").upper()
    status = alert_event.get("status", "firing")
    metric = alert_event.get("metric", "unknown")
    message_text = alert_event.get("message", "")
    value = alert_event.get("value")
    threshold = alert_event.get("threshold")

    color = {"CRITICAL": "#dc2626", "WARNING": "#f59e0b", "INFO": "#3b82f6"}.get(severity, "#6b7280")
    status_label = "RESOLVED" if status == "resolved" else status

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"{'✅' if status == 'resolved' else '🚨'} [{severity}] {status_label.upper()}"},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Device:*\n{device_hostname}"},
                {"type": "mrkdwn", "text": f"*Metric:*\n{metric}"},
            ],
        },
    ]
    if value is not None or threshold is not None:
        fields = []
        if value is not None:
            fields.append({"type": "mrkdwn", "text": f"*Value:*\n{value}"})
        if threshold is not None:
            fields.append({"type": "mrkdwn", "text": f"*Threshold:*\n{threshold}"})
        blocks.append({"type": "section", "fields": fields})

    if message_text:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"*Message:*\n{message_text}"}})

    blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": "TOD Alert System"}]})

    slack_url = channel.get("slack_webhook_url", "")
    if not slack_url:
        logger.warning("Slack channel %s has no webhook URL configured", channel.get("name"))
        return

    payload = {"attachments": [{"color": color, "blocks": blocks}]}

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(slack_url, json=payload)
        logger.info("Slack notification sent — status %d", response.status_code)


async def send_test_notification(channel: dict[str, Any]) -> bool:
    """Send a test notification through a channel to verify configuration.

    Args:
        channel: Notification channel dict with all config fields

    Returns:
        True on success

    Raises:
        Exception on delivery failure (caller handles)
    """
    test_event = {
        "status": "test",
        "severity": "info",
        "metric": "test",
        "value": None,
        "threshold": None,
        "message": "Test notification from TOD",
        "device_id": "00000000-0000-0000-0000-000000000000",
        "fired_at": "",
    }

    if channel["channel_type"] == "email":
        await _send_email(channel, test_event, "Test Device")
    elif channel["channel_type"] == "webhook":
        await _send_webhook(channel, test_event, "Test Device")
    elif channel["channel_type"] == "slack":
        await _send_slack(channel, test_event, "Test Device")
    else:
        raise ValueError(f"Unknown channel type: {channel['channel_type']}")

    return True
