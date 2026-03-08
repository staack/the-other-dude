"""Emergency Kit PDF template generation.

Generates an Emergency Kit PDF containing the user's email and sign-in URL
but NOT the Secret Key. The Secret Key placeholder is filled client-side
so that the server never sees it.

Uses Jinja2 + WeasyPrint following the same pattern as the reports service.
"""

import asyncio
from datetime import UTC, datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from app.config import settings

TEMPLATE_DIR = Path(__file__).parent.parent.parent / "templates"


async def generate_emergency_kit_template(
    email: str,
) -> bytes:
    """Generate Emergency Kit PDF template WITHOUT the Secret Key.

    The Secret Key placeholder will be filled client-side.
    The server never sees the Secret Key.

    Args:
        email: The user's email address to display in the PDF.

    Returns:
        PDF bytes ready for streaming response.
    """
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=True,
    )
    template = env.get_template("emergency_kit.html")

    html_content = template.render(
        email=email,
        signin_url=settings.APP_BASE_URL,
        date=datetime.now(UTC).strftime("%Y-%m-%d"),
        secret_key_placeholder="[Download complete -- your Secret Key will be inserted by your browser]",
    )

    # Run weasyprint in thread to avoid blocking the event loop
    from weasyprint import HTML

    pdf_bytes = await asyncio.to_thread(
        lambda: HTML(string=html_content).write_pdf()
    )
    return pdf_bytes
