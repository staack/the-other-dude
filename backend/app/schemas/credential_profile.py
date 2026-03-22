"""Pydantic schemas for CredentialProfile endpoints."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator, model_validator


VALID_CREDENTIAL_TYPES = ("routeros", "snmp_v1", "snmp_v2c", "snmp_v3")
VALID_SECURITY_LEVELS = ("no_auth_no_priv", "auth_no_priv", "auth_priv")
VALID_AUTH_PROTOCOLS = ("SHA256", "SHA384", "SHA512")
VALID_PRIV_PROTOCOLS = ("AES128", "AES256")


class CredentialProfileCreate(BaseModel):
    """Schema for creating a credential profile."""

    name: str
    description: Optional[str] = None
    credential_type: str

    # RouterOS credential fields
    username: Optional[str] = None
    password: Optional[str] = None

    # SNMP v1/v2c credential fields
    community: Optional[str] = None

    # SNMP v3 credential fields
    security_level: Optional[str] = None
    auth_protocol: Optional[str] = None
    auth_passphrase: Optional[str] = None
    priv_protocol: Optional[str] = None
    priv_passphrase: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1 or len(v) > 255:
            raise ValueError("Profile name must be 1-255 characters")
        return v

    @field_validator("credential_type")
    @classmethod
    def validate_credential_type(cls, v: str) -> str:
        if v not in VALID_CREDENTIAL_TYPES:
            raise ValueError(f"credential_type must be one of: {', '.join(VALID_CREDENTIAL_TYPES)}")
        return v

    @model_validator(mode="after")
    def validate_credentials(self) -> "CredentialProfileCreate":
        """Validate required credential fields based on credential_type."""
        ct = self.credential_type
        if ct == "routeros":
            if not self.username:
                raise ValueError("username is required for routeros credentials")
            if not self.password:
                raise ValueError("password is required for routeros credentials")
        elif ct in ("snmp_v1", "snmp_v2c"):
            if not self.community:
                raise ValueError(f"community is required for {ct} credentials")
        elif ct == "snmp_v3":
            if not self.username:
                raise ValueError("username is required for snmp_v3 credentials")
            if not self.security_level:
                raise ValueError("security_level is required for snmp_v3 credentials")
            if self.security_level not in VALID_SECURITY_LEVELS:
                raise ValueError(
                    f"security_level must be one of: {', '.join(VALID_SECURITY_LEVELS)}"
                )
            # auth fields required if security_level includes auth
            if "auth" in self.security_level and self.security_level != "no_auth_no_priv":
                if not self.auth_protocol:
                    raise ValueError(
                        "auth_protocol is required when security_level includes authentication"
                    )
                if self.auth_protocol not in VALID_AUTH_PROTOCOLS:
                    raise ValueError(
                        f"auth_protocol must be one of: {', '.join(VALID_AUTH_PROTOCOLS)}"
                    )
                if not self.auth_passphrase:
                    raise ValueError(
                        "auth_passphrase is required when security_level includes authentication"
                    )
            # priv fields required if security_level includes priv
            if "priv" in self.security_level and self.security_level != "no_auth_no_priv":
                if self.security_level == "auth_priv":
                    if not self.priv_protocol:
                        raise ValueError(
                            "priv_protocol is required when security_level is auth_priv"
                        )
                    if self.priv_protocol not in VALID_PRIV_PROTOCOLS:
                        raise ValueError(
                            f"priv_protocol must be one of: {', '.join(VALID_PRIV_PROTOCOLS)}"
                        )
                    if not self.priv_passphrase:
                        raise ValueError(
                            "priv_passphrase is required when security_level is auth_priv"
                        )
        return self


class CredentialProfileUpdate(BaseModel):
    """Schema for updating a credential profile. All fields optional."""

    name: Optional[str] = None
    description: Optional[str] = None
    credential_type: Optional[str] = None

    # RouterOS credential fields
    username: Optional[str] = None
    password: Optional[str] = None

    # SNMP v1/v2c credential fields
    community: Optional[str] = None

    # SNMP v3 credential fields
    security_level: Optional[str] = None
    auth_protocol: Optional[str] = None
    auth_passphrase: Optional[str] = None
    priv_protocol: Optional[str] = None
    priv_passphrase: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if len(v) < 1 or len(v) > 255:
            raise ValueError("Profile name must be 1-255 characters")
        return v

    @field_validator("credential_type")
    @classmethod
    def validate_credential_type(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if v not in VALID_CREDENTIAL_TYPES:
            raise ValueError(f"credential_type must be one of: {', '.join(VALID_CREDENTIAL_TYPES)}")
        return v

    @model_validator(mode="after")
    def validate_credentials(self) -> "CredentialProfileUpdate":
        """Validate credential fields only when credential_type or credential fields change."""
        # Collect which credential fields were provided
        cred_fields = {
            "username",
            "password",
            "community",
            "security_level",
            "auth_protocol",
            "auth_passphrase",
            "priv_protocol",
            "priv_passphrase",
        }
        has_cred_changes = any(getattr(self, f) is not None for f in cred_fields)

        # Only validate if credential_type changes or credential fields are provided
        if not self.credential_type and not has_cred_changes:
            return self

        # If credential_type is changing, validate completeness
        ct = self.credential_type
        if ct:
            if ct == "routeros":
                if not self.username:
                    raise ValueError("username is required for routeros credentials")
                if not self.password:
                    raise ValueError("password is required for routeros credentials")
            elif ct in ("snmp_v1", "snmp_v2c"):
                if not self.community:
                    raise ValueError(f"community is required for {ct} credentials")
            elif ct == "snmp_v3":
                if not self.username:
                    raise ValueError("username is required for snmp_v3 credentials")
                if not self.security_level:
                    raise ValueError("security_level is required for snmp_v3 credentials")
                if self.security_level not in VALID_SECURITY_LEVELS:
                    raise ValueError(
                        f"security_level must be one of: {', '.join(VALID_SECURITY_LEVELS)}"
                    )
                if "auth" in self.security_level and self.security_level != "no_auth_no_priv":
                    if not self.auth_protocol:
                        raise ValueError("auth_protocol is required for this security_level")
                    if self.auth_protocol not in VALID_AUTH_PROTOCOLS:
                        raise ValueError(
                            f"auth_protocol must be one of: {', '.join(VALID_AUTH_PROTOCOLS)}"
                        )
                    if not self.auth_passphrase:
                        raise ValueError("auth_passphrase is required for this security_level")
                if self.security_level == "auth_priv":
                    if not self.priv_protocol:
                        raise ValueError("priv_protocol is required for auth_priv")
                    if self.priv_protocol not in VALID_PRIV_PROTOCOLS:
                        raise ValueError(
                            f"priv_protocol must be one of: {', '.join(VALID_PRIV_PROTOCOLS)}"
                        )
                    if not self.priv_passphrase:
                        raise ValueError("priv_passphrase is required for auth_priv")

        return self


class CredentialProfileResponse(BaseModel):
    """Credential profile response schema. NEVER includes credential fields."""

    id: uuid.UUID
    name: str
    description: Optional[str] = None
    credential_type: str
    device_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CredentialProfileListResponse(BaseModel):
    """List of credential profiles."""

    profiles: list[CredentialProfileResponse]
