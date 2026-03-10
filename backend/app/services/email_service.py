"""Unified email sending service.

All email sending (system emails, alert notifications) goes through this module.
Supports TLS, STARTTLS, and plain SMTP. Handles Transit + legacy Fernet password decryption.
"""

import logging
from email.message import EmailMessage
from typing import Optional

import aiosmtplib

logger = logging.getLogger(__name__)


class SMTPConfig:
    """SMTP connection configuration."""

    def __init__(
        self,
        host: str,
        port: int = 587,
        user: Optional[str] = None,
        password: Optional[str] = None,
        use_tls: bool = False,
        from_address: str = "noreply@example.com",
    ):
        self.host = host
        self.port = port
        self.user = user
        self.password = password
        self.use_tls = use_tls
        self.from_address = from_address


async def send_email(
    to: str,
    subject: str,
    html: str,
    plain_text: str,
    smtp_config: SMTPConfig,
) -> None:
    """Send an email via SMTP.

    Args:
        to: Recipient email address.
        subject: Email subject line.
        html: HTML body.
        plain_text: Plain text fallback body.
        smtp_config: SMTP connection settings.

    Raises:
        aiosmtplib.SMTPException: On SMTP connection or send failure.
    """
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = smtp_config.from_address
    msg["To"] = to
    msg.set_content(plain_text)
    msg.add_alternative(html, subtype="html")

    # Port 465 = implicit TLS (use_tls=True, start_tls=False)
    # Port 587 = STARTTLS (use_tls=False, start_tls=True) — only when TLS requested
    # Port 25/other = plain SMTP (use_tls=False, start_tls=False)
    if smtp_config.port == 465:
        use_tls, start_tls = True, False
    elif smtp_config.use_tls:
        use_tls, start_tls = False, True
    else:
        use_tls, start_tls = False, False

    await aiosmtplib.send(
        msg,
        hostname=smtp_config.host,
        port=smtp_config.port,
        username=smtp_config.user or None,
        password=smtp_config.password or None,
        use_tls=use_tls,
        start_tls=start_tls,
    )


async def test_smtp_connection(smtp_config: SMTPConfig) -> dict:
    """Test SMTP connectivity without sending an email.

    Returns:
        dict with "success" bool and "message" string.
    """
    try:
        if smtp_config.port == 465:
            _use_tls, _start_tls = True, False
        elif smtp_config.use_tls:
            _use_tls, _start_tls = False, True
        else:
            _use_tls, _start_tls = False, False
        smtp = aiosmtplib.SMTP(
            hostname=smtp_config.host,
            port=smtp_config.port,
            use_tls=_use_tls,
            start_tls=_start_tls,
        )
        await smtp.connect()
        if smtp_config.user and smtp_config.password:
            await smtp.login(smtp_config.user, smtp_config.password)
        await smtp.quit()
        return {"success": True, "message": "SMTP connection successful"}
    except Exception as e:
        return {"success": False, "message": str(e)}


async def send_test_email(to: str, smtp_config: SMTPConfig) -> dict:
    """Send a test email to verify the full SMTP flow.

    Returns:
        dict with "success" bool and "message" string.
    """
    html = """
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #0f172a; padding: 24px; border-radius: 8px 8px 0 0;">
            <h2 style="color: #38bdf8; margin: 0;">TOD — Email Test</h2>
        </div>
        <div style="background: #1e293b; padding: 24px; border-radius: 0 0 8px 8px; color: #e2e8f0;">
            <p>This is a test email from The Other Dude.</p>
            <p>If you're reading this, your SMTP configuration is working correctly.</p>
            <p style="color: #94a3b8; font-size: 13px; margin-top: 24px;">
                Sent from TOD Fleet Management
            </p>
        </div>
    </div>
    """
    plain = "TOD — Email Test\n\nThis is a test email from The Other Dude.\nIf you're reading this, your SMTP configuration is working correctly."

    try:
        await send_email(to, "TOD — Test Email", html, plain, smtp_config)
        return {"success": True, "message": f"Test email sent to {to}"}
    except Exception as e:
        return {"success": False, "message": str(e)}
