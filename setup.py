#!/usr/bin/env python3
"""TOD Production Setup Wizard.

Interactive setup script that configures .env.prod, bootstraps OpenBao,
builds Docker images, starts the stack, and verifies service health.

Usage:
    python3 setup.py
"""

import base64
import datetime
import getpass
import os
import pathlib
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time

# ── Constants ────────────────────────────────────────────────────────────────

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent
ENV_PROD = PROJECT_ROOT / ".env.prod"
INIT_SQL_TEMPLATE = PROJECT_ROOT / "scripts" / "init-postgres.sql"
INIT_SQL_PROD = PROJECT_ROOT / "scripts" / "init-postgres-prod.sql"
COMPOSE_BASE = "docker-compose.yml"
COMPOSE_PROD = "docker-compose.prod.yml"
COMPOSE_CMD = [
    "docker", "compose",
    "-f", COMPOSE_BASE,
    "-f", COMPOSE_PROD,
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

def green(t: str) -> str: return _c("32", t)
def yellow(t: str) -> str: return _c("33", t)
def red(t: str) -> str: return _c("31", t)
def cyan(t: str) -> str: return _c("36", t)
def bold(t: str) -> str: return _c("1", t)
def dim(t: str) -> str: return _c("2", t)


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


# ── Input helpers ────────────────────────────────────────────────────────────

def ask(prompt: str, default: str = "", required: bool = False,
        secret: bool = False, validate=None) -> str:
    """Prompt the user for input with optional default, validation, and secret mode."""
    suffix = f" [{default}]" if default else ""
    full_prompt = f"  {prompt}{suffix}: "

    while True:
        if secret:
            value = getpass.getpass(full_prompt)
        else:
            value = input(full_prompt)

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
        answer = input(f"  {prompt} [{hint}]: ").strip().lower()
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
            capture_output=True, text=True, timeout=10,
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
            capture_output=True, text=True, timeout=10,
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
                capture_output=True, text=True, timeout=5,
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

        ram_gb = ram_bytes / (1024 ** 3)
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


def check_existing_env() -> str:
    """Check for existing .env.prod. Returns 'overwrite', 'backup', or 'abort'."""
    if not ENV_PROD.exists():
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


def preflight() -> bool:
    """Run all pre-flight checks. Returns True if OK to proceed."""
    banner("TOD Production Setup")
    print("  This wizard will configure your production environment,")
    print("  generate secrets, bootstrap OpenBao, build images, and")
    print("  start the stack.")
    print()

    section("Pre-flight Checks")

    if not check_python_version():
        return False
    if not check_docker():
        return False
    check_ram()
    check_ports()

    action = check_existing_env()
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

def wizard_database(config: dict) -> None:
    section("Database")
    info("PostgreSQL superuser password — used for migrations and admin operations.")
    info("The app and poller service passwords will be auto-generated.")
    print()

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


def wizard_admin(config: dict) -> None:
    section("Admin Account")
    info("The first admin account is created on initial startup.")
    print()

    config["admin_email"] = ask(
        "Admin email",
        default="admin@the-other-dude.dev",
        required=True,
        validate=validate_email,
    )

    print()
    info("Enter a password or press Enter to auto-generate one.")
    password = ask("Admin password", secret=True)

    if password:
        error = validate_password_strength(password)
        while error:
            warn(error)
            password = ask("Admin password", secret=True, required=True,
                           validate=validate_password_strength)
            error = None  # ask() already validated
        config["admin_password"] = password
        config["admin_password_generated"] = False
    else:
        config["admin_password"] = generate_admin_password()
        config["admin_password_generated"] = True
        ok(f"Generated password: {bold(config['admin_password'])}")
        warn("Save this now — it will not be shown again after setup.")


def wizard_email(config: dict) -> None:
    section("Email (SMTP)")
    info("Email is used for password reset links.")
    print()

    if not ask_yes_no("Configure SMTP now?", default=False):
        config["smtp_configured"] = False
        info("Skipped — you can re-run setup.py later to configure email.")
        return

    config["smtp_configured"] = True
    config["smtp_host"] = ask("SMTP host", required=True)
    config["smtp_port"] = ask("SMTP port", default="587")
    config["smtp_user"] = ask("SMTP username (optional)")
    config["smtp_password"] = ask("SMTP password (optional)", secret=True) if config["smtp_user"] else ""
    config["smtp_from"] = ask("From address", required=True, validate=validate_email)
    config["smtp_tls"] = ask_yes_no("Use TLS?", default=True)


def wizard_domain(config: dict) -> None:
    section("Web / Domain")
    info("Your production domain, used for CORS and email links.")
    print()

    raw = ask("Production domain (e.g. tod.example.com)", required=True, validate=validate_domain)
    domain = re.sub(r"^https?://", "", raw).rstrip("/")
    config["domain"] = domain
    config["app_base_url"] = f"https://{domain}"
    config["cors_origins"] = f"https://{domain}"

    ok(f"APP_BASE_URL=https://{domain}")
    ok(f"CORS_ORIGINS=https://{domain}")


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
            "YOUR_TOD_HOST": None,    # replaced with host IP
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


def wizard_reverse_proxy(config: dict) -> None:
    section("Reverse Proxy")
    info("TOD needs a reverse proxy for HTTPS termination.")
    info("Example configs are included for Caddy, nginx, Apache, HAProxy, and Traefik.")
    print()

    if not ask_yes_no("Configure a reverse proxy now?", default=True):
        config["proxy_configured"] = False
        info("Skipped. Example configs are in infrastructure/reverse-proxy-examples/")
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
            info("Skipped. Example configs are in infrastructure/reverse-proxy-examples/")
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

    custom_path = ask(f"Write config to", default=str(out_path))
    out_path = pathlib.Path(custom_path)

    if out_path.exists():
        if not ask_yes_no(f"{out_path} already exists. Overwrite?", default=False):
            info("Skipped writing proxy config.")
            config["proxy_configured"] = False
            return

    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output)
        ok(f"Wrote {cfg['label']} config to {out_path}")
        config["proxy_configured"] = True
        config["proxy_type"] = cfg["label"]
        config["proxy_path"] = str(out_path)

        # Post-install hints
        print()
        if selected == "caddy":
            info("Reload Caddy:  systemctl reload caddy")
        elif selected == "nginx":
            if "/sites-available/" in str(out_path):
                sites_enabled = out_path.parent.parent / "sites-enabled" / out_path.name
                info(f"Enable site:   ln -s {out_path} {sites_enabled}")
            info("Test config:   nginx -t")
            info("Reload nginx:  systemctl reload nginx")
        elif selected == "apache":
            if "/sites-available/" in str(out_path):
                info(f"Enable site:   a2ensite {out_path.stem}")
            info("Test config:   apachectl configtest")
            info("Reload Apache: systemctl reload apache2")
        elif selected == "haproxy":
            info("Test config:   haproxy -c -f /etc/haproxy/haproxy.cfg")
            info("Reload:        systemctl reload haproxy")
        elif selected == "traefik":
            info("Traefik watches for file changes — no reload needed.")

    except PermissionError:
        fail(f"Permission denied writing to {out_path}")
        warn(f"Try running with sudo, or copy manually:")
        info(f"  The config has been printed above.")
        config["proxy_configured"] = False
    except Exception as e:
        fail(f"Failed to write config: {e}")
        config["proxy_configured"] = False


# ── Summary ──────────────────────────────────────────────────────────────────

def show_summary(config: dict) -> bool:
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
    print(f"    Password             = {'(auto-generated)' if config.get('admin_password_generated') else mask_secret(config['admin_password'])}")
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

    print(f"  {bold('OpenBao')}")
    print(f"    {dim('(will be captured automatically during bootstrap)')}")
    print()

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
SMTP_HOST={config['smtp_host']}
SMTP_PORT={config['smtp_port']}
SMTP_USER={config.get('smtp_user', '')}
SMTP_PASSWORD={config.get('smtp_password', '')}
SMTP_USE_TLS={'true' if config.get('smtp_tls') else 'false'}
SMTP_FROM_ADDRESS={config['smtp_from']}"""
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
POLLER_DATABASE_URL=postgres://poller_user:{poll_pw}@postgres:5432/{db}

# --- Security ---
JWT_SECRET_KEY={config['jwt_secret']}
CREDENTIAL_ENCRYPTION_KEY={config['encryption_key']}

# --- OpenBao (KMS) ---
OPENBAO_ADDR=http://openbao:8200
OPENBAO_TOKEN=PLACEHOLDER_RUN_SETUP
BAO_UNSEAL_KEY=PLACEHOLDER_RUN_SETUP

# --- Admin Bootstrap ---
FIRST_ADMIN_EMAIL={config['admin_email']}
FIRST_ADMIN_PASSWORD={config['admin_password']}

# --- Email ---
{smtp_block}

# --- Web ---
APP_BASE_URL={config['app_base_url']}
CORS_ORIGINS={config['cors_origins']}

# --- Application ---
ENVIRONMENT=production
LOG_LEVEL=info
DEBUG=false
APP_NAME=TOD - The Other Dude

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
    INIT_SQL_PROD.chmod(0o600)
    ok(f"Wrote {INIT_SQL_PROD.name}")


# ── Docker operations ────────────────────────────────────────────────────────

def run_compose(*args, check: bool = True, capture: bool = False,
                timeout: int = 600) -> subprocess.CompletedProcess:
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
            ["docker", "inspect", "--format", "{{.State.Health.Status}}", "tod_openbao"],
            capture_output=True, text=True, timeout=10,
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
        env_content = env_content.replace("OPENBAO_TOKEN=PLACEHOLDER_RUN_SETUP",
                                          f"OPENBAO_TOKEN={root_token}")
        env_content = env_content.replace("BAO_UNSEAL_KEY=PLACEHOLDER_RUN_SETUP",
                                          f"BAO_UNSEAL_KEY={unseal_key}")
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
            warn("Could not find credentials in logs (OpenBao may already be initialized).")
            warn("Check 'docker compose logs openbao' and update .env.prod manually.")
            return False
        else:
            ok("OpenBao already initialized — existing credentials in .env.prod")
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
            info(f"  docker compose -f {COMPOSE_BASE} -f {COMPOSE_PROD} build {service}")
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

    while pending and time.time() < deadline:
        for container, label in list(pending.items()):
            try:
                result = subprocess.run(
                    ["docker", "inspect", "--format",
                     "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
                     container],
                    capture_output=True, text=True, timeout=5,
                )
                status = result.stdout.strip()
                if status in ("healthy", "running"):
                    ok(f"{label}: {status}")
                    del pending[container]
            except Exception:
                pass

        if pending:
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
            print(f"    Password: (the password you entered)")
        print()
        info("Change the admin password after your first login.")
    else:
        warn("Some services are not healthy. Check the logs above.")
        info(f"  docker compose -f {COMPOSE_BASE} -f {COMPOSE_PROD} logs")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    # Graceful Ctrl+C
    env_written = False

    def handle_sigint(sig, frame):
        nonlocal env_written
        print()
        if not env_written:
            info("Aborted before writing .env.prod — no files changed.")
        else:
            warn(f".env.prod was already written to {ENV_PROD}")
            info("OpenBao tokens may still be placeholders if bootstrap didn't complete.")
        sys.exit(1)

    signal.signal(signal.SIGINT, handle_sigint)

    os.chdir(PROJECT_ROOT)

    # Phase 1: Pre-flight
    if not preflight():
        return 1

    # Phase 2: Wizard
    config: dict = {}
    wizard_database(config)
    wizard_security(config)
    wizard_admin(config)
    wizard_email(config)
    wizard_domain(config)
    wizard_reverse_proxy(config)

    # Summary
    if not show_summary(config):
        info("Setup cancelled.")
        return 1

    # Phase 3: Write files
    section("Writing Configuration")
    write_env_prod(config)
    write_init_sql_prod(config)
    env_written = True

    # Phase 4: OpenBao
    bao_ok = bootstrap_openbao(config)
    if not bao_ok:
        if not ask_yes_no("Continue without OpenBao credentials? (stack will need manual fix)", default=False):
            warn("Fix OpenBao credentials in .env.prod and re-run setup.py.")
            return 1

    # Phase 5: Build
    if not build_images():
        warn("Fix the build error and re-run setup.py to continue.")
        return 1

    # Phase 6: Start
    if not start_stack():
        return 1

    # Phase 7: Health
    health_check(config)

    return 0


if __name__ == "__main__":
    sys.exit(main())
