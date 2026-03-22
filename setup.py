#!/usr/bin/env python3
"""TOD Production Setup Wizard.

Interactive setup script that configures .env.prod, bootstraps OpenBao,
builds Docker images, starts the stack, and verifies service health.

Usage:
    python3 setup.py                          # Interactive mode
    python3 setup.py --non-interactive \\
        --postgres-password 'MyP@ss!' \\
        --domain tod.example.com \\
        --admin-email admin@example.com \\
        --no-telemetry --yes                  # Non-interactive mode
"""

import argparse
import base64
import datetime
import getpass
import json
import os
import pathlib
import platform
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

# ── Constants ────────────────────────────────────────────────────────────────

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent
ENV_PROD = PROJECT_ROOT / ".env.prod"
INIT_SQL_TEMPLATE = PROJECT_ROOT / "scripts" / "init-postgres.sql"
INIT_SQL_PROD = PROJECT_ROOT / "scripts" / "init-postgres-prod.sql"
COMPOSE_BASE = "docker-compose.yml"
COMPOSE_PROD = "docker-compose.prod.yml"
COMPOSE_BUILD_OVERRIDE = "docker-compose.build.yml"
COMPOSE_CMD = [
    "docker",
    "compose",
    "-f",
    COMPOSE_BASE,
    "-f",
    COMPOSE_PROD,
]

REQUIRED_PORTS = {
    5432: "PostgreSQL",
    6379: "Redis",
    4222: "NATS",
    8001: "API",
    3000: "Frontend",
    51820: "WireGuard (UDP)",
}


# ── Color helpers ────────────────────────────────────────────────────────────


def _supports_color() -> bool:
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()


_COLOR = _supports_color()


def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _COLOR else text


def green(t: str) -> str:
    return _c("32", t)


def yellow(t: str) -> str:
    return _c("33", t)


def red(t: str) -> str:
    return _c("31", t)


def cyan(t: str) -> str:
    return _c("36", t)


def bold(t: str) -> str:
    return _c("1", t)


def dim(t: str) -> str:
    return _c("2", t)


def banner(text: str) -> None:
    width = 62
    print()
    print(cyan("=" * width))
    print(cyan(f"  {text}"))
    print(cyan("=" * width))
    print()


def section(text: str) -> None:
    print()
    print(bold(f"--- {text} ---"))
    print()


def ok(text: str) -> None:
    print(f"  {green('✓')} {text}")


def warn(text: str) -> None:
    print(f"  {yellow('!')} {text}")


def fail(text: str) -> None:
    print(f"  {red('✗')} {text}")


def info(text: str) -> None:
    print(f"  {dim('·')} {text}")


# ── Setup Telemetry ─────────────────────────────────────────────────────────

_TELEMETRY_COLLECTOR = "https://telemetry.theotherdude.net"
_TELEMETRY_TOKEN = "75e320cbd48e20e3234ab4e734f86e124a903a7278e643cf6d383708a8a7fe4b"


def _collect_environment() -> dict:
    """Gather allowlisted environment info. No IPs, hostnames, or secrets."""
    env = {
        "os": platform.system(),
        "os_version": platform.release(),
        "arch": platform.machine(),
        "python": platform.python_version(),
    }
    # Docker version
    try:
        r = subprocess.run(
            ["docker", "version", "--format", "{{.Server.Version}}"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if r.returncode == 0:
            env["docker"] = r.stdout.strip()
    except Exception:
        pass
    # Compose version
    try:
        r = subprocess.run(
            ["docker", "compose", "version", "--short"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if r.returncode == 0:
            env["compose"] = r.stdout.strip()
    except Exception:
        pass
    # RAM (rounded to nearest GB)
    try:
        if sys.platform == "darwin":
            r = subprocess.run(
                ["sysctl", "-n", "hw.memsize"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if r.returncode == 0:
                env["ram_gb"] = round(int(r.stdout.strip()) / (1024**3))
        else:
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        env["ram_gb"] = round(int(line.split()[1]) * 1024 / (1024**3))
                        break
    except Exception:
        pass
    return env


def _get_app_version() -> tuple[str, str]:
    """Return (version, build_id) from git if available."""
    version = "unknown"
    build_id = "unknown"
    try:
        r = subprocess.run(
            ["git", "describe", "--tags", "--always"],
            capture_output=True,
            text=True,
            timeout=5,
            cwd=PROJECT_ROOT,
        )
        if r.returncode == 0:
            version = r.stdout.strip()
    except Exception:
        pass
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            cwd=PROJECT_ROOT,
        )
        if r.returncode == 0:
            build_id = r.stdout.strip()
    except Exception:
        pass
    return version, build_id


class SetupTelemetry:
    """Lightweight fire-and-forget telemetry for setup diagnostics.

    When enabled, sends one event per setup step to the TOD telemetry collector.
    All events use a shared anonymous token — no registration, no PII.
    """

    def __init__(self) -> None:
        self.enabled = False
        self._environment: dict = {}
        self._app_version = "unknown"
        self._build_id = "unknown"

    def enable(self) -> None:
        self.enabled = True
        self._environment = _collect_environment()
        self._app_version, self._build_id = _get_app_version()

    def step(
        self,
        step_name: str,
        result: str,
        duration_ms: int | None = None,
        error_message: str | None = None,
        error_code: str | None = None,
        metrics: dict | None = None,
    ) -> None:
        """Emit a single setup step event. No-op if disabled."""
        if not self.enabled:
            return

        event: dict = {
            "event_type": "setup",
            "severity": "error" if result == "failure" else "info",
            "phase": "setup",
            "operation": step_name,
            "result": result,
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "app_version": self._app_version,
            "build_id": self._build_id,
            "environment": self._environment,
        }
        if duration_ms is not None:
            event["duration_ms"] = duration_ms
        if error_message:
            event["error"] = {"message": error_message[:500], "code": error_code or ""}
        if metrics:
            event["metrics"] = metrics

        self._send([event])

    def _send(self, events: list[dict]) -> None:
        """POST events to the collector. Fire-and-forget."""
        try:
            body = json.dumps({"events": events}).encode()
            req = urllib.request.Request(
                f"{_TELEMETRY_COLLECTOR}/api/v1/ingest",
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {_TELEMETRY_TOKEN}",
                },
                method="POST",
            )
            urllib.request.urlopen(req, timeout=10)
        except Exception:
            pass  # Fire-and-forget — never affect setup


# ── Input helpers ────────────────────────────────────────────────────────────


def ask(
    prompt: str,
    default: str = "",
    required: bool = False,
    secret: bool = False,
    validate=None,
) -> str:
    """Prompt the user for input with optional default, validation, and secret mode."""
    suffix = f" [{default}]" if default else ""
    full_prompt = f"  {prompt}{suffix}: "

    while True:
        try:
            if secret:
                value = getpass.getpass(full_prompt)
            else:
                value = input(full_prompt)
        except EOFError:
            if default:
                return default
            if required:
                raise SystemExit(
                    f"EOF reached and no default for required field: {prompt}"
                )
            return ""

        value = value.strip()
        if not value and default:
            value = default

        if required and not value:
            warn("This field is required.")
            continue

        if validate:
            error = validate(value)
            if error:
                warn(error)
                continue

        return value


def ask_yes_no(prompt: str, default: bool = False) -> bool:
    """Ask a yes/no question."""
    hint = "Y/n" if default else "y/N"
    while True:
        try:
            answer = input(f"  {prompt} [{hint}]: ").strip().lower()
        except EOFError:
            return default
        if not answer:
            return default
        if answer in ("y", "yes"):
            return True
        if answer in ("n", "no"):
            return False
        warn("Please enter y or n.")


def mask_secret(value: str) -> str:
    """Show first 8 chars of a secret, mask the rest."""
    if len(value) <= 12:
        return "*" * len(value)
    return value[:8] + "..."


# ── Validators ───────────────────────────────────────────────────────────────


def validate_password_strength(value: str) -> str | None:
    if len(value) < 12:
        return "Password must be at least 12 characters."
    return None


def validate_email(value: str) -> str | None:
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", value):
        return "Please enter a valid email address."
    return None


def validate_domain(value: str) -> str | None:
    # Strip protocol if provided
    cleaned = re.sub(r"^https?://", "", value).rstrip("/")
    if not re.match(r"^[a-zA-Z0-9]([a-zA-Z0-9\-]*\.)+[a-zA-Z]{2,}$", cleaned):
        return "Please enter a valid domain (e.g. tod.example.com)."
    return None


# ── System checks ────────────────────────────────────────────────────────────


def check_python_version() -> bool:
    if sys.version_info < (3, 10):
        fail(f"Python 3.10+ required, found {sys.version}")
        return False
    ok(f"Python {sys.version_info.major}.{sys.version_info.minor}")
    return True


def check_docker() -> bool:
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            fail("Docker is not running. Start Docker and try again.")
            return False
        ok("Docker Engine")
    except FileNotFoundError:
        fail("Docker is not installed.")
        return False
    except subprocess.TimeoutExpired:
        fail("Docker is not responding.")
        return False

    try:
        result = subprocess.run(
            ["docker", "compose", "version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            fail("Docker Compose v2 is not available.")
            return False
        version_match = re.search(r"v?(\d+\.\d+)", result.stdout)
        version_str = version_match.group(1) if version_match else "unknown"
        ok(f"Docker Compose v{version_str}")
    except FileNotFoundError:
        fail("Docker Compose is not installed.")
        return False

    return True


def check_ram() -> None:
    try:
        if sys.platform == "darwin":
            result = subprocess.run(
                ["sysctl", "-n", "hw.memsize"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode != 0:
                return
            ram_bytes = int(result.stdout.strip())
        else:
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        ram_bytes = int(line.split()[1]) * 1024
                        break
                else:
                    return

        ram_gb = ram_bytes / (1024**3)
        if ram_gb < 4:
            warn(f"Only {ram_gb:.1f} GB RAM detected. 4 GB+ recommended for builds.")
        else:
            ok(f"{ram_gb:.1f} GB RAM")
    except Exception:
        info("Could not detect RAM — skipping check")


def check_ports() -> None:
    for port, service in REQUIRED_PORTS.items():
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                result = s.connect_ex(("127.0.0.1", port))
                if result == 0:
                    warn(f"Port {port} ({service}) is already in use")
                else:
                    ok(f"Port {port} ({service}) is free")
        except Exception:
            info(f"Could not check port {port} ({service})")


def check_existing_env(args: argparse.Namespace) -> str:
    """Check for existing .env.prod. Returns 'overwrite', 'backup', or 'abort'."""
    if not ENV_PROD.exists():
        return "overwrite"

    if args.non_interactive:
        ts = datetime.datetime.now().strftime("%Y%m%dT%H%M%S")
        backup = ENV_PROD.with_name(f".env.prod.backup.{ts}")
        shutil.copy2(ENV_PROD, backup)
        ok(f"Backed up existing .env.prod to {backup.name}")
        return "overwrite"

    print()
    warn(f"Existing .env.prod found at {ENV_PROD}")
    print()
    print("  What would you like to do?")
    print(f"    {bold('1)')} Overwrite it")
    print(f"    {bold('2)')} Back it up and create a new one")
    print(f"    {bold('3)')} Abort")
    print()

    while True:
        choice = input("  Choice [1/2/3]: ").strip()
        if choice == "1":
            return "overwrite"
        elif choice == "2":
            ts = datetime.datetime.now().strftime("%Y%m%dT%H%M%S")
            backup = ENV_PROD.with_name(f".env.prod.backup.{ts}")
            shutil.copy2(ENV_PROD, backup)
            ok(f"Backed up to {backup.name}")
            return "overwrite"
        elif choice == "3":
            return "abort"
        else:
            warn("Please enter 1, 2, or 3.")


def preflight(args: argparse.Namespace) -> bool:
    """Run all pre-flight checks. Returns True if OK to proceed."""
    banner("TOD Production Setup")
    print("  This wizard will configure your production environment,")
    print("  generate secrets, bootstrap OpenBao, pull or build images,")
    print("  and start the stack.")
    print()

    section("Pre-flight Checks")

    if not check_python_version():
        return False
    if not check_docker():
        return False
    check_ram()
    check_ports()

    action = check_existing_env(args)
    if action == "abort":
        print()
        info("Setup aborted.")
        return False

    return True


# ── Secret generation ────────────────────────────────────────────────────────


def generate_jwt_secret() -> str:
    return secrets.token_urlsafe(64)


def generate_encryption_key() -> str:
    return base64.b64encode(secrets.token_bytes(32)).decode()


def generate_db_password() -> str:
    return secrets.token_urlsafe(24)


def generate_admin_password() -> str:
    return secrets.token_urlsafe(18)


# ── Wizard sections ─────────────────────────────────────────────────────────


def wizard_database(config: dict, args: argparse.Namespace) -> None:
    section("Database")
    info("PostgreSQL superuser password — used for migrations and admin operations.")
    info("The app and poller service passwords will be auto-generated.")
    print()

    if args.non_interactive:
        if not args.postgres_password:
            fail("--postgres-password is required in non-interactive mode.")
            raise SystemExit(1)
        config["postgres_password"] = args.postgres_password
    else:
        config["postgres_password"] = ask(
            "PostgreSQL superuser password",
            required=True,
            secret=True,
            validate=validate_password_strength,
        )

    config["app_user_password"] = generate_db_password()
    config["poller_user_password"] = generate_db_password()
    config["postgres_db"] = "tod"

    ok("Database passwords configured")
    info(f"app_user password: {mask_secret(config['app_user_password'])}")
    info(f"poller_user password: {mask_secret(config['poller_user_password'])}")


def wizard_security(config: dict) -> None:
    section("Security")
    info("Auto-generating cryptographic keys...")
    print()

    config["jwt_secret"] = generate_jwt_secret()
    config["encryption_key"] = generate_encryption_key()

    ok("JWT signing key generated")
    ok("Credential encryption key generated")
    print()
    warn("Save these somewhere safe — they cannot be recovered if lost:")
    info(f"JWT_SECRET_KEY={mask_secret(config['jwt_secret'])}")
    info(f"CREDENTIAL_ENCRYPTION_KEY={mask_secret(config['encryption_key'])}")


def wizard_admin(config: dict, args: argparse.Namespace) -> None:
    section("Admin Account")
    info("The first admin account is created on initial startup.")
    print()

    if args.non_interactive:
        config["admin_email"] = args.admin_email or "admin@the-other-dude.dev"
    else:
        config["admin_email"] = ask(
            "Admin email",
            default="admin@the-other-dude.dev",
            required=True,
            validate=validate_email,
        )

    if args.non_interactive:
        if args.admin_password:
            config["admin_password"] = args.admin_password
            config["admin_password_generated"] = False
        else:
            config["admin_password"] = generate_admin_password()
            config["admin_password_generated"] = True
            ok(f"Generated password: {bold(config['admin_password'])}")
            warn("Save this now — it will not be shown again after setup.")
    else:
        print()
        info("Enter a password or press Enter to auto-generate one.")
        password = ask("Admin password", secret=True)

        if password:
            error = validate_password_strength(password)
            while error:
                warn(error)
                password = ask(
                    "Admin password",
                    secret=True,
                    required=True,
                    validate=validate_password_strength,
                )
                error = None  # ask() already validated
            config["admin_password"] = password
            config["admin_password_generated"] = False
        else:
            config["admin_password"] = generate_admin_password()
            config["admin_password_generated"] = True
            ok(f"Generated password: {bold(config['admin_password'])}")
            warn("Save this now — it will not be shown again after setup.")


def wizard_email(config: dict, args: argparse.Namespace) -> None:
    section("Email (SMTP)")
    info("Email is used for password reset links.")
    print()

    if args.non_interactive:
        if not args.smtp_host:
            config["smtp_configured"] = False
            info("Skipped — no --smtp-host provided.")
            return
        config["smtp_configured"] = True
        config["smtp_host"] = args.smtp_host
        config["smtp_port"] = args.smtp_port or "587"
        config["smtp_user"] = args.smtp_user or ""
        config["smtp_password"] = args.smtp_password or ""
        config["smtp_from"] = args.smtp_from or ""
        if not config["smtp_from"]:
            fail("--smtp-from is required when --smtp-host is provided.")
            raise SystemExit(1)
        # Determine TLS setting: --no-smtp-tls wins if set, otherwise default True
        if args.no_smtp_tls:
            config["smtp_tls"] = False
        else:
            config["smtp_tls"] = True
        return

    if not ask_yes_no("Configure SMTP now?", default=False):
        config["smtp_configured"] = False
        info("Skipped — you can re-run setup.py later to configure email.")
        return

    config["smtp_configured"] = True
    config["smtp_host"] = ask("SMTP host", required=True)
    config["smtp_port"] = ask("SMTP port", default="587")
    config["smtp_user"] = ask("SMTP username (optional)")
    config["smtp_password"] = (
        ask("SMTP password (optional)", secret=True) if config["smtp_user"] else ""
    )
    config["smtp_from"] = ask("From address", required=True, validate=validate_email)
    config["smtp_tls"] = ask_yes_no("Use TLS?", default=True)


def wizard_domain(config: dict, args: argparse.Namespace) -> None:
    section("Web / Domain")
    info("Your production domain, used for CORS and email links.")
    print()

    if args.non_interactive:
        if not args.domain:
            fail("--domain is required in non-interactive mode.")
            raise SystemExit(1)
        raw = args.domain
    else:
        raw = ask(
            "Production domain (e.g. tod.example.com)",
            required=True,
            validate=validate_domain,
        )

    domain = re.sub(r"^https?://", "", raw).rstrip("/")
    config["domain"] = domain

    # Determine protocol — default HTTPS for production, allow HTTP for LAN/dev
    if args.non_interactive:
        use_https = not getattr(args, "no_https", False)
    else:
        use_https = ask_yes_no(
            "Use HTTPS? (disable for LAN/dev without TLS)", default=True
        )

    protocol = "https" if use_https else "http"
    config["app_base_url"] = f"{protocol}://{domain}"
    config["cors_origins"] = f"{protocol}://{domain}"

    ok(f"APP_BASE_URL={protocol}://{domain}")
    ok(f"CORS_ORIGINS={protocol}://{domain}")
    if not use_https:
        warn(
            "Running without HTTPS — cookies will not be Secure. Fine for LAN, not for public internet."
        )


# ── Reverse proxy ───────────────────────────────────────────────────────────

PROXY_EXAMPLES = PROJECT_ROOT / "infrastructure" / "reverse-proxy-examples"

PROXY_CONFIGS = {
    "caddy": {
        "label": "Caddy",
        "binary": "caddy",
        "example": PROXY_EXAMPLES / "caddy" / "Caddyfile.example",
        "targets": [
            pathlib.Path("/etc/caddy/Caddyfile.d"),
            pathlib.Path("/etc/caddy"),
        ],
        "filename": None,  # derived from domain
        "placeholders": {
            "tod.example.com": None,  # replaced with domain
            "YOUR_TOD_HOST": None,  # replaced with host IP
        },
    },
    "nginx": {
        "label": "nginx",
        "binary": "nginx",
        "example": PROXY_EXAMPLES / "nginx" / "tod.conf.example",
        "targets": [
            pathlib.Path("/etc/nginx/sites-available"),
            pathlib.Path("/etc/nginx/conf.d"),
        ],
        "filename": None,
        "placeholders": {
            "tod.example.com": None,
            "YOUR_TOD_HOST": None,
        },
    },
    "apache": {
        "label": "Apache",
        "binary": "apache2",
        "alt_binary": "httpd",
        "example": PROXY_EXAMPLES / "apache" / "tod.conf.example",
        "targets": [
            pathlib.Path("/etc/apache2/sites-available"),
            pathlib.Path("/etc/httpd/conf.d"),
        ],
        "filename": None,
        "placeholders": {
            "tod.example.com": None,
            "YOUR_TOD_HOST": None,
        },
    },
    "haproxy": {
        "label": "HAProxy",
        "binary": "haproxy",
        "example": PROXY_EXAMPLES / "haproxy" / "haproxy.cfg.example",
        "targets": [
            pathlib.Path("/etc/haproxy"),
        ],
        "filename": "haproxy.cfg",
        "placeholders": {
            "tod.example.com": None,
            "YOUR_TOD_HOST": None,
        },
    },
    "traefik": {
        "label": "Traefik",
        "binary": "traefik",
        "example": PROXY_EXAMPLES / "traefik" / "traefik-dynamic.yaml.example",
        "targets": [
            pathlib.Path("/etc/traefik/dynamic"),
            pathlib.Path("/etc/traefik"),
        ],
        "filename": None,
        "placeholders": {
            "tod.example.com": None,
            "YOUR_TOD_HOST": None,
        },
    },
}


def _detect_proxy(name: str, cfg: dict) -> bool:
    """Check if a reverse proxy binary is installed."""
    binary = cfg["binary"]
    if shutil.which(binary):
        return True
    alt = cfg.get("alt_binary")
    if alt and shutil.which(alt):
        return True
    return False


def _get_host_ip() -> str:
    """Best-effort detection of the host's LAN IP."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def _write_system_file(path: pathlib.Path, content: str) -> bool:
    """Write a file, using sudo tee if direct write fails with permission error."""
    # Try direct write first
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return True
    except PermissionError:
        pass

    # Fall back to sudo
    info(f"Need elevated permissions to write to {path.parent}")
    if not ask_yes_no("Use sudo?", default=True):
        warn("Skipped. You can copy the config manually later.")
        return False

    try:
        # Ensure parent directory exists
        subprocess.run(
            ["sudo", "mkdir", "-p", str(path.parent)],
            check=True,
            timeout=30,
        )
        # Write via sudo tee
        result = subprocess.run(
            ["sudo", "tee", str(path)],
            input=content,
            text=True,
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            fail(f"sudo tee failed: {result.stderr.strip()}")
            return False
        return True
    except subprocess.CalledProcessError as e:
        fail(f"sudo failed: {e}")
        return False
    except Exception as e:
        fail(f"Failed to write config: {e}")
        return False


def wizard_reverse_proxy(config: dict, args: argparse.Namespace) -> None:
    section("Reverse Proxy")
    info("TOD needs a reverse proxy for HTTPS termination.")
    info("Example configs are included for Caddy, nginx, Apache, HAProxy, and Traefik.")
    print()

    if args.non_interactive:
        proxy_val = args.proxy or "skip"
        if proxy_val == "skip":
            config["proxy_configured"] = False
            info(
                "Skipped. Example configs are in infrastructure/reverse-proxy-examples/"
            )
            return
        valid_proxies = list(PROXY_CONFIGS.keys())
        if proxy_val not in valid_proxies:
            fail(f"--proxy must be one of: {', '.join(valid_proxies)}, skip")
            raise SystemExit(1)
        selected = proxy_val
    else:
        if not ask_yes_no("Configure a reverse proxy now?", default=True):
            config["proxy_configured"] = False
            info(
                "Skipped. Example configs are in infrastructure/reverse-proxy-examples/"
            )
            return

        # Detect installed proxies
        detected = []
        for name, cfg in PROXY_CONFIGS.items():
            if _detect_proxy(name, cfg):
                detected.append(name)

        if detected:
            print()
            info(f"Detected: {', '.join(PROXY_CONFIGS[n]['label'] for n in detected)}")
        else:
            print()
            info("No reverse proxy detected on this system.")

        # Show menu
        print()
        print("  Which reverse proxy are you using?")
        choices = list(PROXY_CONFIGS.keys())
        for i, name in enumerate(choices, 1):
            label = PROXY_CONFIGS[name]["label"]
            tag = f" {green('(detected)')}" if name in detected else ""
            print(f"    {bold(f'{i})')} {label}{tag}")
        print(f"    {bold(f'{len(choices) + 1})')} Skip — I'll configure it myself")
        print()

        while True:
            choice = input(f"  Choice [1-{len(choices) + 1}]: ").strip()
            if not choice.isdigit():
                warn("Please enter a number.")
                continue
            idx = int(choice) - 1
            if idx == len(choices):
                config["proxy_configured"] = False
                info(
                    "Skipped. Example configs are in infrastructure/reverse-proxy-examples/"
                )
                return
            if 0 <= idx < len(choices):
                break
            warn(f"Please enter 1-{len(choices) + 1}.")

        selected = choices[idx]
    cfg = PROXY_CONFIGS[selected]
    domain = config["domain"]
    host_ip = _get_host_ip()

    # Read and customize the example config
    if not cfg["example"].exists():
        fail(f"Example config not found: {cfg['example']}")
        config["proxy_configured"] = False
        return

    template = cfg["example"].read_text()

    # Replace placeholders
    output = template.replace("tod.example.com", domain)
    output = output.replace("YOUR_TOD_HOST", host_ip)

    # Determine output filename
    if cfg["filename"]:
        out_name = cfg["filename"]
    else:
        safe_domain = domain.replace(".", "-")
        ext = cfg["example"].suffix.replace(".example", "") or ".conf"
        if cfg["example"].name == "Caddyfile.example":
            out_name = f"{safe_domain}.caddy"
        else:
            out_name = f"{safe_domain}{ext}"

    # Find a writable target directory
    target_dir = None
    for candidate in cfg["targets"]:
        if candidate.is_dir():
            target_dir = candidate
            break

    print()
    if target_dir:
        out_path = target_dir / out_name
        info(f"Will write: {out_path}")
    else:
        # Fall back to project directory
        out_path = PROJECT_ROOT / out_name
        info(f"No standard config directory found for {cfg['label']}.")
        info(f"Will write to: {out_path}")

    print()
    info("Preview (first 20 lines):")
    for line in output.splitlines()[:20]:
        print(f"    {dim(line)}")
    print(f"    {dim('...')}")
    print()

    custom_path = ask("Write config to", default=str(out_path))
    out_path = pathlib.Path(custom_path)

    if out_path.exists():
        if not ask_yes_no(f"{out_path} already exists. Overwrite?", default=False):
            info("Skipped writing proxy config.")
            config["proxy_configured"] = False
            return

    written = _write_system_file(out_path, output)

    if not written:
        config["proxy_configured"] = False
        return

    ok(f"Wrote {cfg['label']} config to {out_path}")
    config["proxy_configured"] = True
    config["proxy_type"] = cfg["label"]
    config["proxy_path"] = str(out_path)

    # Post-install hints
    print()
    if selected == "caddy":
        info("Reload Caddy:  sudo systemctl reload caddy")
    elif selected == "nginx":
        if "/sites-available/" in str(out_path):
            sites_enabled = out_path.parent.parent / "sites-enabled" / out_path.name
            info(f"Enable site:   sudo ln -s {out_path} {sites_enabled}")
        info("Test config:   sudo nginx -t")
        info("Reload nginx:  sudo systemctl reload nginx")
    elif selected == "apache":
        if "/sites-available/" in str(out_path):
            info(f"Enable site:   sudo a2ensite {out_path.stem}")
        info("Test config:   sudo apachectl configtest")
        info("Reload Apache: sudo systemctl reload apache2")
    elif selected == "haproxy":
        info("Test config:   sudo haproxy -c -f /etc/haproxy/haproxy.cfg")
        info("Reload:        sudo systemctl reload haproxy")
    elif selected == "traefik":
        info("Traefik watches for file changes — no reload needed.")


def wizard_telemetry(
    config: dict, telem: SetupTelemetry, args: argparse.Namespace
) -> None:
    section("Anonymous Diagnostics")
    info("TOD can send anonymous setup and runtime diagnostics to help")
    info("identify common failures. No personal data, IPs, hostnames,")
    info("or configuration values are ever sent.")
    print()
    info("What is collected: step pass/fail, duration, OS/arch/Python")
    info("version, Docker version, RAM (rounded), and error types.")
    info("You can disable this anytime by setting TELEMETRY_ENABLED=false")
    info("in .env.prod.")
    print()

    if args.non_interactive:
        if args.telemetry:
            config["telemetry_enabled"] = True
            telem.enable()
            ok("Diagnostics enabled — thank you!")
        else:
            config["telemetry_enabled"] = False
            info("No diagnostics will be sent.")
        return

    if ask_yes_no("Send anonymous diagnostics?", default=False):
        config["telemetry_enabled"] = True
        telem.enable()
        ok("Diagnostics enabled — thank you!")
    else:
        config["telemetry_enabled"] = False
        info("No diagnostics will be sent.")


def _read_version() -> str:
    """Read the version string from the VERSION file."""
    version_file = PROJECT_ROOT / "VERSION"
    if version_file.exists():
        return version_file.read_text().strip()
    return "latest"


def wizard_build_mode(config: dict, args: argparse.Namespace) -> None:
    """Ask whether to use pre-built images or build from source."""
    section("Build Mode")

    version = _read_version()
    config["tod_version"] = version

    if args.non_interactive:
        mode = getattr(args, "build_mode", None) or "prebuilt"
        config["build_mode"] = mode
        if mode == "source":
            COMPOSE_CMD.extend(["-f", COMPOSE_BUILD_OVERRIDE])
            ok(f"Build from source (v{version})")
        else:
            ok(f"Pre-built images from GHCR (v{version})")
        return

    print(f"  TOD v{bold(version)} can be installed two ways:")
    print()
    print(f"    {bold('1.')} {green('Pre-built images')} {dim('(recommended)')}")
    print("       Pull ready-to-run images from GitHub Container Registry.")
    print("       Fast install, no compilation needed.")
    print()
    print(f"    {bold('2.')} Build from source")
    print("       Compile Go, Python, and Node.js locally.")
    print("       Requires 4+ GB RAM and takes 5-15 minutes.")
    print()

    while True:
        choice = input("  Choice [1/2]: ").strip()
        if choice in ("1", ""):
            config["build_mode"] = "prebuilt"
            ok("Pre-built images from GHCR")
            break
        elif choice == "2":
            config["build_mode"] = "source"
            COMPOSE_CMD.extend(["-f", COMPOSE_BUILD_OVERRIDE])
            ok("Build from source")
            break
        else:
            warn("Please enter 1 or 2.")


# ── Summary ──────────────────────────────────────────────────────────────────


def show_summary(config: dict, args: argparse.Namespace) -> bool:
    banner("Configuration Summary")

    print(f"  {bold('Database')}")
    print(f"    POSTGRES_DB          = {config['postgres_db']}")
    print(f"    POSTGRES_PASSWORD    = {mask_secret(config['postgres_password'])}")
    print(f"    app_user password    = {mask_secret(config['app_user_password'])}")
    print(f"    poller_user password = {mask_secret(config['poller_user_password'])}")
    print()

    print(f"  {bold('Security')}")
    print(f"    JWT_SECRET_KEY       = {mask_secret(config['jwt_secret'])}")
    print(f"    ENCRYPTION_KEY       = {mask_secret(config['encryption_key'])}")
    print()

    print(f"  {bold('Admin Account')}")
    print(f"    Email                = {config['admin_email']}")
    print(
        f"    Password             = {'(auto-generated)' if config.get('admin_password_generated') else mask_secret(config['admin_password'])}"
    )
    print()

    print(f"  {bold('Email')}")
    if config.get("smtp_configured"):
        print(f"    SMTP_HOST            = {config['smtp_host']}")
        print(f"    SMTP_PORT            = {config['smtp_port']}")
        print(f"    SMTP_FROM            = {config['smtp_from']}")
        print(f"    SMTP_TLS             = {config['smtp_tls']}")
    else:
        print(f"    {dim('(not configured)')}")
    print()

    print(f"  {bold('Web')}")
    print(f"    Domain               = {config['domain']}")
    print(f"    APP_BASE_URL         = {config['app_base_url']}")
    print()

    print(f"  {bold('Reverse Proxy')}")
    if config.get("proxy_configured"):
        print(f"    Type                 = {config['proxy_type']}")
        print(f"    Config               = {config['proxy_path']}")
    else:
        print(f"    {dim('(not configured)')}")
    print()

    print(f"  {bold('Diagnostics')}")
    if config.get("telemetry_enabled"):
        print(f"    TELEMETRY_ENABLED    = {green('true')}")
    else:
        print(f"    TELEMETRY_ENABLED    = {dim('false')}")
    print()

    print(f"  {bold('Build Mode')}")
    if config.get("build_mode") == "source":
        print("    Mode                 = Build from source")
    else:
        print(f"    Mode                 = {green('Pre-built images')}")
    print(f"    Version              = {config.get('tod_version', 'latest')}")
    print()

    print(f"  {bold('OpenBao')}")
    print(f"    {dim('(will be captured automatically during bootstrap)')}")
    print()

    if args.yes:
        ok("Auto-confirmed (--yes)")
        return True

    return ask_yes_no("Write .env.prod with these settings?", default=True)


# ── File writers ─────────────────────────────────────────────────────────────


def write_env_prod(config: dict) -> None:
    """Write the .env.prod file."""
    db = config["postgres_db"]
    pg_pw = config["postgres_password"]
    app_pw = config["app_user_password"]
    poll_pw = config["poller_user_password"]
    ts = datetime.datetime.now().isoformat(timespec="seconds")

    smtp_block = ""
    if config.get("smtp_configured"):
        smtp_block = f"""\
SMTP_HOST={config["smtp_host"]}
SMTP_PORT={config["smtp_port"]}
SMTP_USER={config.get("smtp_user", "")}
SMTP_PASSWORD={config.get("smtp_password", "")}
SMTP_USE_TLS={"true" if config.get("smtp_tls") else "false"}
SMTP_FROM_ADDRESS={config["smtp_from"]}"""
    else:
        smtp_block = """\
# Email not configured — re-run setup.py to add SMTP
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_USE_TLS=true
SMTP_FROM_ADDRESS=noreply@example.com"""

    content = f"""\
# ============================================================
# TOD Production Environment — generated by setup.py
# Generated: {ts}
# ============================================================

# --- Database ---
POSTGRES_DB={db}
POSTGRES_USER=postgres
POSTGRES_PASSWORD={pg_pw}
DATABASE_URL=postgresql+asyncpg://postgres:{pg_pw}@postgres:5432/{db}
SYNC_DATABASE_URL=postgresql+psycopg2://postgres:{pg_pw}@postgres:5432/{db}
APP_USER_DATABASE_URL=postgresql+asyncpg://app_user:{app_pw}@postgres:5432/{db}
POLLER_DATABASE_URL=postgres://poller_user:{poll_pw}@postgres:5432/{db}?sslmode=disable

# --- Security ---
JWT_SECRET_KEY={config["jwt_secret"]}
CREDENTIAL_ENCRYPTION_KEY={config["encryption_key"]}

# --- OpenBao (KMS) ---
OPENBAO_ADDR=http://openbao:8200
OPENBAO_TOKEN=PLACEHOLDER_RUN_SETUP
BAO_UNSEAL_KEY=PLACEHOLDER_RUN_SETUP

# --- Admin Bootstrap ---
FIRST_ADMIN_EMAIL={config["admin_email"]}
FIRST_ADMIN_PASSWORD={config["admin_password"]}

# --- Email ---
{smtp_block}

# --- Web ---
APP_BASE_URL={config["app_base_url"]}
CORS_ORIGINS={config["cors_origins"]}

# --- Application ---
ENVIRONMENT=production
LOG_LEVEL=info
DEBUG=false
APP_NAME=TOD - The Other Dude
TOD_VERSION={config.get("tod_version", "latest")}

# --- Storage ---
GIT_STORE_PATH=/data/git-store
FIRMWARE_CACHE_DIR=/data/firmware-cache
WIREGUARD_CONFIG_PATH=/data/wireguard
WIREGUARD_GATEWAY=wireguard
CONFIG_RETENTION_DAYS=90

# --- Redis & NATS ---
REDIS_URL=redis://redis:6379/0
NATS_URL=nats://nats:4222

# --- Poller ---
POLL_INTERVAL_SECONDS=60
CONNECTION_TIMEOUT_SECONDS=10
COMMAND_TIMEOUT_SECONDS=30

# --- Remote Access ---
TUNNEL_PORT_MIN=49000
TUNNEL_PORT_MAX=49100
TUNNEL_IDLE_TIMEOUT=300
SSH_RELAY_PORT=8080
SSH_IDLE_TIMEOUT=900

# --- Config Backup ---
CONFIG_BACKUP_INTERVAL=21600
CONFIG_BACKUP_MAX_CONCURRENT=10

# --- Telemetry ---
# Opt-in anonymous diagnostics. Set to false to disable.
TELEMETRY_ENABLED={"true" if config.get("telemetry_enabled") else "false"}
TELEMETRY_COLLECTOR_URL={_TELEMETRY_COLLECTOR}
"""

    ENV_PROD.write_text(content)
    ENV_PROD.chmod(0o600)
    ok(f"Wrote {ENV_PROD.name}")


def write_init_sql_prod(config: dict) -> None:
    """Generate init-postgres-prod.sql with production passwords."""
    app_pw = config["app_user_password"]
    poll_pw = config["poller_user_password"]
    db = config["postgres_db"]

    # Use dollar-quoting ($pw$...$pw$) to avoid SQL injection from passwords
    content = f"""\
-- Production database init — generated by setup.py
-- Passwords match those in .env.prod

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user WITH LOGIN PASSWORD $pw${app_pw}$pw$ NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE {db} TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'poller_user') THEN
        CREATE ROLE poller_user WITH LOGIN PASSWORD $pw${poll_pw}$pw$ NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE {db} TO poller_user;
GRANT USAGE ON SCHEMA public TO poller_user;
"""

    INIT_SQL_PROD.write_text(content)
    INIT_SQL_PROD.chmod(0o644)  # postgres container needs to read this
    ok(f"Wrote {INIT_SQL_PROD.name}")


# ── Data directory setup ─────────────────────────────────────────────────────

# UID 1001 = appuser inside the API container
APPUSER_UID = 1001

# Directories the API container writes to (as appuser)
API_WRITABLE_DIRS = [
    "docker-data/git-store",
    "docker-data/firmware-cache",
]

# Directories that need broad write access (shared between containers)
SHARED_WRITABLE_DIRS = [
    "docker-data/wireguard/wg_confs",
]

# Directories that just need to exist (owned by their respective containers)
DATA_DIRS = [
    "docker-data/postgres",
    "docker-data/redis",
    "docker-data/nats",
    "docker-data/wireguard",
    "docker-data/wireguard/custom-cont-init.d",
]


def prepare_data_dirs() -> None:
    """Create data directories with correct ownership and permissions."""
    section("Preparing Data Directories")

    # Create all directories
    for d in DATA_DIRS + API_WRITABLE_DIRS + SHARED_WRITABLE_DIRS:
        path = PROJECT_ROOT / d
        path.mkdir(parents=True, exist_ok=True)

    # Set ownership for API-writable dirs (appuser uid 1001)
    for d in API_WRITABLE_DIRS:
        path = PROJECT_ROOT / d
        try:
            os.chown(path, APPUSER_UID, APPUSER_UID)
            ok(f"{d} (owned by appuser)")
        except PermissionError:
            # Try with sudo
            try:
                subprocess.run(
                    ["sudo", "chown", "-R", f"{APPUSER_UID}:{APPUSER_UID}", str(path)],
                    check=True,
                    timeout=10,
                )
                ok(f"{d} (owned by appuser via sudo)")
            except Exception:
                warn(f"{d} — could not set ownership, backups/firmware may fail")

    # Set permissions for shared dirs (API + WireGuard container both write)
    for d in SHARED_WRITABLE_DIRS:
        path = PROJECT_ROOT / d
        try:
            path.chmod(0o777)
            ok(f"{d} (world-writable for container sharing)")
        except PermissionError:
            try:
                subprocess.run(
                    ["sudo", "chmod", "-R", "777", str(path)],
                    check=True,
                    timeout=10,
                )
                ok(f"{d} (world-writable via sudo)")
            except Exception:
                warn(f"{d} — could not set permissions, VPN config sync may fail")

    # Create/update WireGuard forwarding init script (always overwrite for isolation rules)
    fwd_script = (
        PROJECT_ROOT / "docker-data/wireguard/custom-cont-init.d/10-forwarding.sh"
    )
    fwd_script.write_text("""\
#!/bin/sh
# Enable forwarding between Docker network and WireGuard tunnel
# Idempotent: check before adding to prevent duplicates on restart
# Allow Docker→VPN (poller/API reaching devices)
iptables -C FORWARD -i eth0 -o wg0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i eth0 -o wg0 -j ACCEPT
# Allow VPN→Docker ONLY (devices reaching poller/API, NOT the public internet)
iptables -C FORWARD -i wg0 -o eth0 -d 172.16.0.0/12 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i wg0 -o eth0 -d 172.16.0.0/12 -j ACCEPT
# Block VPN→anywhere else (prevents using server as exit node)
iptables -C FORWARD -i wg0 -o eth0 -j DROP 2>/dev/null || iptables -A FORWARD -i wg0 -o eth0 -j DROP

# Block cross-subnet traffic on wg0 (tenant isolation)
# Peers in 10.10.1.0/24 cannot reach peers in 10.10.2.0/24
iptables -C FORWARD -i wg0 -o wg0 -j DROP 2>/dev/null || iptables -A FORWARD -i wg0 -o wg0 -j DROP

# Block IPv6 forwarding on wg0 (prevent link-local bypass)
ip6tables -C FORWARD -i wg0 -j DROP 2>/dev/null || ip6tables -A FORWARD -i wg0 -j DROP

# NAT for return traffic — per-tenant SNAT rules applied by wg-reload watcher

echo "WireGuard forwarding and tenant isolation rules applied"
""")
    fwd_script.chmod(0o755)
    ok("WireGuard forwarding init script created")

    ok("Data directories ready")


# ── Docker operations ────────────────────────────────────────────────────────


def run_compose(
    *args, check: bool = True, capture: bool = False, timeout: int = 600
) -> subprocess.CompletedProcess:
    """Run a docker compose command with the prod overlay."""
    cmd = COMPOSE_CMD + ["--env-file", str(ENV_PROD)] + list(args)
    return subprocess.run(
        cmd,
        capture_output=capture,
        text=True,
        timeout=timeout,
        check=check,
        cwd=PROJECT_ROOT,
    )


def bootstrap_openbao(config: dict) -> bool:
    """Start OpenBao, capture credentials, update .env.prod."""
    section("OpenBao Bootstrap")
    info("Starting PostgreSQL and OpenBao containers...")

    try:
        run_compose("up", "-d", "postgres", "openbao")
    except subprocess.CalledProcessError as e:
        fail("Failed to start OpenBao containers.")
        info(str(e))
        return False

    info("Waiting for OpenBao to initialize (up to 60s)...")

    # Wait for the container to be healthy
    deadline = time.time() + 60
    healthy = False
    while time.time() < deadline:
        result = subprocess.run(
            [
                "docker",
                "inspect",
                "--format",
                "{{.State.Health.Status}}",
                "tod_openbao",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        status = result.stdout.strip()
        if status == "healthy":
            healthy = True
            break
        time.sleep(2)

    if not healthy:
        fail("OpenBao did not become healthy within 60 seconds.")
        warn("Your .env.prod has placeholder tokens. To fix manually:")
        info("  docker compose logs openbao")
        info("  Look for BAO_UNSEAL_KEY and OPENBAO_TOKEN lines")
        info("  Update .env.prod with those values")
        return False

    ok("OpenBao is healthy")

    # Parse credentials from container logs
    info("Capturing OpenBao credentials from logs...")
    result = run_compose("logs", "openbao", check=False, capture=True, timeout=30)

    logs = result.stdout + result.stderr
    unseal_match = re.search(r"BAO_UNSEAL_KEY=(\S+)", logs)
    token_match = re.search(r"OPENBAO_TOKEN=(\S+)", logs)

    if unseal_match and token_match:
        unseal_key = unseal_match.group(1)
        root_token = token_match.group(1)

        # Update .env.prod
        env_content = ENV_PROD.read_text()
        env_content = env_content.replace(
            "OPENBAO_TOKEN=PLACEHOLDER_RUN_SETUP", f"OPENBAO_TOKEN={root_token}"
        )
        env_content = env_content.replace(
            "BAO_UNSEAL_KEY=PLACEHOLDER_RUN_SETUP", f"BAO_UNSEAL_KEY={unseal_key}"
        )
        ENV_PROD.write_text(env_content)
        ENV_PROD.chmod(0o600)

        ok("OpenBao credentials captured and saved to .env.prod")
        info(f"OPENBAO_TOKEN={mask_secret(root_token)}")
        info(f"BAO_UNSEAL_KEY={mask_secret(unseal_key)}")
        return True
    else:
        # OpenBao was already initialized — check if .env.prod has real values
        env_content = ENV_PROD.read_text()
        if "PLACEHOLDER_RUN_SETUP" in env_content:
            warn(
                "Could not find credentials in logs (OpenBao may already be initialized)."
            )
            warn("Check 'docker compose logs openbao' and update .env.prod manually.")
            return False
        else:
            ok("OpenBao already initialized — existing credentials in .env.prod")
            return True


def pull_images() -> bool:
    """Pull pre-built images from GHCR."""
    section("Pulling Images")
    info("Downloading pre-built images from GitHub Container Registry...")
    print()

    services = ["api", "poller", "frontend", "winbox-worker"]

    for i, service in enumerate(services, 1):
        info(f"[{i}/{len(services)}] Pulling {service}...")
        try:
            run_compose("pull", service, timeout=600)
            ok(f"{service} pulled successfully")
        except subprocess.CalledProcessError:
            fail(f"Failed to pull {service}")
            print()
            warn("Check your internet connection and that the image exists.")
            warn("To retry:")
            info(
                f"  docker compose -f {COMPOSE_BASE} -f {COMPOSE_PROD} "
                f"--env-file .env.prod pull {service}"
            )
            return False
        except subprocess.TimeoutExpired:
            fail(f"Pull of {service} timed out (10 min)")
            return False

    print()
    ok("All images ready")
    return True


def build_images() -> bool:
    """Build Docker images one at a time to avoid OOM."""
    section("Building Images")
    info("Building images sequentially to avoid memory issues...")
    print()

    services = ["api", "poller", "frontend", "winbox-worker"]

    for i, service in enumerate(services, 1):
        info(f"[{i}/{len(services)}] Building {service}...")
        try:
            run_compose("build", service, timeout=900)
            ok(f"{service} built successfully")
        except subprocess.CalledProcessError:
            fail(f"Failed to build {service}")
            print()
            warn("To retry this build:")
            info(
                f"  docker compose -f {COMPOSE_BASE} -f {COMPOSE_PROD} "
                f"-f {COMPOSE_BUILD_OVERRIDE} build {service}"
            )
            return False
        except subprocess.TimeoutExpired:
            fail(f"Build of {service} timed out (15 min)")
            return False

    print()
    ok("All images built successfully")
    return True


def start_stack() -> bool:
    """Start the full stack."""
    section("Starting Stack")
    info("Bringing up all services...")

    try:
        run_compose("up", "-d")
        ok("Stack started")
        return True
    except subprocess.CalledProcessError as e:
        fail("Failed to start stack")
        info(str(e))
        return False


def health_check(config: dict) -> None:
    """Poll service health for up to 60 seconds."""
    section("Health Check")
    info("Checking service health (up to 60s)...")
    print()

    services = [
        ("tod_postgres", "PostgreSQL"),
        ("tod_redis", "Redis"),
        ("tod_nats", "NATS"),
        ("tod_openbao", "OpenBao"),
        ("tod_api", "API"),
        ("tod_poller", "Poller"),
        ("tod_frontend", "Frontend"),
        ("tod_winbox_worker", "WinBox Worker"),
    ]

    deadline = time.time() + 60
    pending = dict(services)
    last_waiting_msg = 0

    while pending and time.time() < deadline:
        for container, label in list(pending.items()):
            try:
                result = subprocess.run(
                    [
                        "docker",
                        "inspect",
                        "--format",
                        "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
                        container,
                    ],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                status = result.stdout.strip()
                if status in ("healthy", "running"):
                    ok(f"{label}: {status}")
                    del pending[container]
            except Exception:
                pass

        if pending:
            now = time.time()
            remaining = int(deadline - now)
            if now - last_waiting_msg >= 10:
                waiting_names = ", ".join(label for _, label in pending.items())
                info(f"Waiting for: {waiting_names} ({remaining}s remaining)")
                last_waiting_msg = now
            time.sleep(3)

    for container, label in pending.items():
        fail(f"{label}: not healthy")
        info(f"  Check logs: docker compose logs {container.replace('tod_', '')}")

    # Final summary
    print()
    if not pending:
        banner("Setup Complete!")
        print(f"  {bold('Access your instance:')}")
        print(f"    URL:      {green(config['app_base_url'])}")
        print(f"    Email:    {config['admin_email']}")
        if config.get("admin_password_generated"):
            print(f"    Password: {bold(config['admin_password'])}")
        else:
            print("    Password: (the password you entered)")
        print()
        info("Change the admin password after your first login.")
    else:
        warn("Some services are not healthy. Check the logs above.")
        info(f"  docker compose -f {COMPOSE_BASE} -f {COMPOSE_PROD} logs")


# ── Main ─────────────────────────────────────────────────────────────────────


def _timed(telem: SetupTelemetry, step_name: str, func, *args, **kwargs):
    """Run func, emit a telemetry event with timing. Returns func's result."""
    t0 = time.monotonic()
    try:
        result = func(*args, **kwargs)
        duration_ms = int((time.monotonic() - t0) * 1000)
        telem.step(step_name, "success", duration_ms=duration_ms)
        return result
    except Exception as e:
        duration_ms = int((time.monotonic() - t0) * 1000)
        telem.step(
            step_name,
            "failure",
            duration_ms=duration_ms,
            error_message=str(e),
            error_code=type(e).__name__,
        )
        raise


def _build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""
    parser = argparse.ArgumentParser(
        description="TOD Production Setup Wizard",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--non-interactive",
        action="store_true",
        help="Skip all prompts, use defaults + provided flags",
    )
    parser.add_argument(
        "--postgres-password",
        type=str,
        default=None,
        help="PostgreSQL superuser password",
    )
    parser.add_argument(
        "--admin-email",
        type=str,
        default=None,
        help="Admin email (default: admin@the-other-dude.dev)",
    )
    parser.add_argument(
        "--admin-password",
        type=str,
        default=None,
        help="Admin password (auto-generated if not provided)",
    )
    parser.add_argument(
        "--domain",
        type=str,
        default=None,
        help="Production domain (e.g. tod.example.com)",
    )
    parser.add_argument(
        "--smtp-host",
        type=str,
        default=None,
        help="SMTP host (skip email config if not provided)",
    )
    parser.add_argument(
        "--smtp-port", type=str, default=None, help="SMTP port (default: 587)"
    )
    parser.add_argument("--smtp-user", type=str, default=None, help="SMTP username")
    parser.add_argument("--smtp-password", type=str, default=None, help="SMTP password")
    parser.add_argument("--smtp-from", type=str, default=None, help="SMTP from address")
    parser.add_argument(
        "--smtp-tls",
        action="store_true",
        default=False,
        help="Use TLS for SMTP (default: true in non-interactive)",
    )
    parser.add_argument(
        "--no-smtp-tls", action="store_true", default=False, help="Disable TLS for SMTP"
    )
    parser.add_argument(
        "--no-https",
        action="store_true",
        default=False,
        help="Use HTTP instead of HTTPS (for LAN/dev without TLS)",
    )
    parser.add_argument(
        "--proxy",
        type=str,
        default=None,
        help="Reverse proxy type: caddy, nginx, apache, haproxy, traefik, skip",
    )
    parser.add_argument(
        "--telemetry",
        action="store_true",
        default=False,
        help="Enable anonymous diagnostics",
    )
    parser.add_argument(
        "--no-telemetry",
        action="store_true",
        default=False,
        help="Disable anonymous diagnostics",
    )
    parser.add_argument(
        "--build-mode",
        type=str,
        default=None,
        choices=["prebuilt", "source"],
        help="Image source: prebuilt (pull from GHCR) or source (compile locally)",
    )
    parser.add_argument(
        "--yes",
        "-y",
        action="store_true",
        default=False,
        help="Auto-confirm summary (don't prompt for confirmation)",
    )
    return parser


def main() -> int:
    # Parse CLI arguments
    parser = _build_parser()
    args = parser.parse_args()

    # Graceful Ctrl+C
    env_written = False
    telem = SetupTelemetry()
    setup_start = time.monotonic()

    def handle_sigint(sig, frame):
        nonlocal env_written
        telem.step(
            "setup_total",
            "failure",
            duration_ms=int((time.monotonic() - setup_start) * 1000),
            error_message="User cancelled (SIGINT)",
        )
        print()
        if not env_written:
            info("Aborted before writing .env.prod — no files changed.")
        else:
            warn(f".env.prod was already written to {ENV_PROD}")
            info(
                "OpenBao tokens may still be placeholders if bootstrap didn't complete."
            )
        sys.exit(1)

    signal.signal(signal.SIGINT, handle_sigint)

    os.chdir(PROJECT_ROOT)

    # Phase 1: Pre-flight
    if not preflight(args):
        telem.step("preflight", "failure")
        return 1
    telem.step("preflight", "success")

    # Telemetry opt-in (right after preflight, before wizard)
    config: dict = {}
    wizard_telemetry(config, telem, args)

    # Phase 2: Wizard
    try:
        wizard_build_mode(config, args)
        wizard_database(config, args)
        wizard_security(config)
        wizard_admin(config, args)
        wizard_email(config, args)
        wizard_domain(config, args)
        wizard_reverse_proxy(config, args)
        telem.step("wizard", "success")
    except Exception as e:
        telem.step(
            "wizard", "failure", error_message=str(e), error_code=type(e).__name__
        )
        raise

    # Summary
    if not show_summary(config, args):
        info("Setup cancelled.")
        telem.step(
            "setup_total",
            "failure",
            duration_ms=int((time.monotonic() - setup_start) * 1000),
            error_message="User cancelled at summary",
        )
        return 1

    # Phase 3: Write files and prepare directories
    section("Writing Configuration")
    try:
        write_env_prod(config)
        write_init_sql_prod(config)
        env_written = True
        prepare_data_dirs()
        telem.step("write_config", "success")
    except Exception as e:
        telem.step(
            "write_config", "failure", error_message=str(e), error_code=type(e).__name__
        )
        raise

    # Phase 4: OpenBao
    t0 = time.monotonic()
    bao_ok = bootstrap_openbao(config)
    duration_ms = int((time.monotonic() - t0) * 1000)
    if bao_ok:
        telem.step("openbao_bootstrap", "success", duration_ms=duration_ms)
    else:
        telem.step(
            "openbao_bootstrap",
            "failure",
            duration_ms=duration_ms,
            error_message="OpenBao did not become healthy or credentials not found",
        )
        if not ask_yes_no(
            "Continue without OpenBao credentials? (stack will need manual fix)",
            default=False,
        ):
            warn("Fix OpenBao credentials in .env.prod and re-run setup.py.")
            telem.step(
                "setup_total",
                "failure",
                duration_ms=int((time.monotonic() - setup_start) * 1000),
                error_message="Aborted after OpenBao failure",
            )
            return 1

    # Phase 5: Build or Pull
    t0 = time.monotonic()
    if config.get("build_mode") == "source":
        images_ok = build_images()
        step_name = "build_images"
        fail_msg = "Docker build failed"
        retry_hint = "Fix the build error and re-run setup.py to continue."
    else:
        images_ok = pull_images()
        step_name = "pull_images"
        fail_msg = "Image pull failed"
        retry_hint = "Check your connection and re-run setup.py to continue."

    if not images_ok:
        duration_ms = int((time.monotonic() - t0) * 1000)
        telem.step(step_name, "failure", duration_ms=duration_ms)
        warn(retry_hint)
        telem.step(
            "setup_total",
            "failure",
            duration_ms=int((time.monotonic() - setup_start) * 1000),
            error_message=fail_msg,
        )
        return 1
    duration_ms = int((time.monotonic() - t0) * 1000)
    telem.step(step_name, "success", duration_ms=duration_ms)

    # Phase 6: Start
    t0 = time.monotonic()
    if not start_stack():
        duration_ms = int((time.monotonic() - t0) * 1000)
        telem.step("start_stack", "failure", duration_ms=duration_ms)
        telem.step(
            "setup_total",
            "failure",
            duration_ms=int((time.monotonic() - setup_start) * 1000),
            error_message="Stack failed to start",
        )
        return 1
    duration_ms = int((time.monotonic() - t0) * 1000)
    telem.step("start_stack", "success", duration_ms=duration_ms)

    # Phase 7: Health
    t0 = time.monotonic()
    health_check(config)
    duration_ms = int((time.monotonic() - t0) * 1000)
    telem.step("health_check", "success", duration_ms=duration_ms)

    # Done
    total_ms = int((time.monotonic() - setup_start) * 1000)
    telem.step("setup_total", "success", duration_ms=total_ms)

    return 0


if __name__ == "__main__":
    sys.exit(main())
