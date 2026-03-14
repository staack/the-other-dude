"""Application configuration using Pydantic Settings."""

import base64
import sys
from functools import lru_cache
from typing import Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Known insecure default values that MUST NOT be used in non-dev environments.
# If any of these are detected in production/staging, the app refuses to start.
KNOWN_INSECURE_DEFAULTS: dict[str, list[str]] = {
    "JWT_SECRET_KEY": [
        "change-this-in-production-use-a-long-random-string",
        "dev-jwt-secret-change-in-production",
        "CHANGE_ME_IN_PRODUCTION",
    ],
    "CREDENTIAL_ENCRYPTION_KEY": [
        "LLLjnfBZTSycvL2U07HDSxUeTtLxb9cZzryQl0R9E4w=",
        "CHANGE_ME_IN_PRODUCTION",
    ],
    "OPENBAO_TOKEN": [
        "dev-openbao-token",
        "",
    ],
}


def validate_production_settings(settings: "Settings") -> None:
    """Reject known-insecure defaults in non-dev environments.

    Called during app startup. Exits with code 1 and clear error message
    if production is running with dev secrets.
    """
    if settings.ENVIRONMENT == "dev":
        return

    for field, insecure_values in KNOWN_INSECURE_DEFAULTS.items():
        actual = getattr(settings, field, None)
        if actual in insecure_values:
            print(
                f"FATAL: {field} uses a known insecure default in '{settings.ENVIRONMENT}' environment.\n"
                f"Generate a secure value and set it in your .env.prod file.\n"
                f"For JWT_SECRET_KEY: python -c \"import secrets; print(secrets.token_urlsafe(64))\"\n"
                f"For CREDENTIAL_ENCRYPTION_KEY: python -c \"import secrets, base64; print(base64.b64encode(secrets.token_bytes(32)).decode())\"\n"
                f"For OPENBAO_TOKEN: use the token from your OpenBao server (not the dev token)",
                file=sys.stderr,
            )
            sys.exit(1)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Environment (dev | staging | production)
    ENVIRONMENT: str = "dev"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/mikrotik"
    # Sync URL used by Alembic only
    SYNC_DATABASE_URL: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/mikrotik"

    # App user for RLS enforcement (cannot bypass RLS)
    APP_USER_DATABASE_URL: str = "postgresql+asyncpg://app_user:app_password@localhost:5432/mikrotik"

    # Database connection pool
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 40
    DB_ADMIN_POOL_SIZE: int = 10
    DB_ADMIN_MAX_OVERFLOW: int = 20

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # NATS JetStream
    NATS_URL: str = "nats://localhost:4222"

    # JWT configuration
    JWT_SECRET_KEY: str = "change-this-in-production-use-a-long-random-string"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Credential encryption key — must be 32 bytes, base64-encoded in env
    # Generate with: python -c "import secrets, base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"
    CREDENTIAL_ENCRYPTION_KEY: str = "LLLjnfBZTSycvL2U07HDSxUeTtLxb9cZzryQl0R9E4w="

    # OpenBao Transit (KMS for per-tenant credential encryption)
    OPENBAO_ADDR: str = "http://localhost:8200"
    OPENBAO_TOKEN: str = ""

    # First admin bootstrap
    FIRST_ADMIN_EMAIL: Optional[str] = None
    FIRST_ADMIN_PASSWORD: Optional[str] = None

    # CORS origins (comma-separated)
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173,http://localhost:8080"

    # Git store — PVC mount for bare git repos (one per tenant).
    # In production: /data/git-store (Kubernetes PVC ReadWriteMany).
    # In local dev: ./git-store (relative to cwd, created on first use).
    GIT_STORE_PATH: str = "./git-store"

    # WireGuard config path — shared volume with the WireGuard container
    WIREGUARD_CONFIG_PATH: str = "/data/wireguard"

    # Firmware cache
    FIRMWARE_CACHE_DIR: str = "/data/firmware-cache"  # PVC mount path
    FIRMWARE_CHECK_INTERVAL_HOURS: int = 24  # How often to check for new versions

    # SMTP settings for transactional email (password reset, etc.)
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_USE_TLS: bool = False
    SMTP_FROM_ADDRESS: str = "noreply@the-other-dude.local"

    # Password reset
    PASSWORD_RESET_TOKEN_EXPIRE_MINUTES: int = 30
    APP_BASE_URL: str = "http://localhost:3000"

    # Retention cleanup — delete config snapshots older than N days
    CONFIG_RETENTION_DAYS: int = 90

    # App settings
    APP_NAME: str = "TOD - The Other Dude"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    @field_validator("CREDENTIAL_ENCRYPTION_KEY")
    @classmethod
    def validate_encryption_key(cls, v: str) -> str:
        """Ensure the key decodes to exactly 32 bytes.

        Note: CHANGE_ME_IN_PRODUCTION is allowed through this validator
        because it fails the base64 length check. The production safety
        check in validate_production_settings() catches it separately.
        """
        if v == "CHANGE_ME_IN_PRODUCTION":
            # Allow the placeholder through field validation -- the production
            # safety check will reject it in non-dev environments.
            return v
        try:
            key_bytes = base64.b64decode(v)
            if len(key_bytes) != 32:
                raise ValueError(
                    f"CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes, got {len(key_bytes)}"
                )
        except Exception as e:
            raise ValueError(f"Invalid CREDENTIAL_ENCRYPTION_KEY: {e}") from e
        return v

    def get_encryption_key_bytes(self) -> bytes:
        """Return the encryption key as raw bytes."""
        return base64.b64decode(self.CREDENTIAL_ENCRYPTION_KEY)

    def get_cors_origins(self) -> list[str]:
        """Return CORS origins as a list."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


@lru_cache()
def get_settings() -> Settings:
    """Return cached settings instance.

    Validates that production environments do not use insecure defaults.
    This runs once (cached) at startup before the app accepts requests.
    """
    s = Settings()
    validate_production_settings(s)
    return s


settings = get_settings()
