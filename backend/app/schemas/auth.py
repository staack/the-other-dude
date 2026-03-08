"""Authentication request/response schemas."""

import uuid
from typing import Optional

from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    auth_upgrade_required: bool = False  # True when bcrypt user needs SRP registration


class RefreshRequest(BaseModel):
    refresh_token: str


class UserMeResponse(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: str
    tenant_id: Optional[uuid.UUID] = None
    auth_version: int = 1

    model_config = {"from_attributes": True}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    # SRP users must provide re-derived credentials
    new_srp_salt: Optional[str] = None
    new_srp_verifier: Optional[str] = None
    # Re-wrapped key bundle (SRP users re-encrypt with new AUK)
    encrypted_private_key: Optional[str] = None
    private_key_nonce: Optional[str] = None
    encrypted_vault_key: Optional[str] = None
    vault_key_nonce: Optional[str] = None
    public_key: Optional[str] = None
    pbkdf2_salt: Optional[str] = None
    hkdf_salt: Optional[str] = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class MessageResponse(BaseModel):
    message: str


# --- SRP Zero-Knowledge Authentication Schemas ---


class SRPInitRequest(BaseModel):
    """Step 1 request: client sends email to begin SRP handshake."""
    email: EmailStr


class SRPInitResponse(BaseModel):
    """Step 1 response: server returns ephemeral B and key derivation salts."""
    salt: str  # hex-encoded SRP salt
    server_public: str  # hex-encoded server ephemeral B
    session_id: str  # Redis session key nonce
    pbkdf2_salt: str  # base64-encoded, from user_key_sets (needed for 2SKD before SRP verify)
    hkdf_salt: str  # base64-encoded, from user_key_sets (needed for 2SKD before SRP verify)


class SRPVerifyRequest(BaseModel):
    """Step 2 request: client sends proof M1 to complete handshake."""
    email: EmailStr
    session_id: str
    client_public: str  # hex-encoded client ephemeral A
    client_proof: str  # hex-encoded client proof M1


class SRPVerifyResponse(BaseModel):
    """Step 2 response: server returns tokens and proof M2."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    server_proof: str  # hex-encoded server proof M2
    encrypted_key_set: Optional[dict] = None  # Key bundle for client-side decryption


class SRPRegisterRequest(BaseModel):
    """Used during registration to store SRP verifier and key set."""
    srp_salt: str  # hex-encoded
    srp_verifier: str  # hex-encoded
    encrypted_private_key: str  # base64-encoded
    private_key_nonce: str  # base64-encoded
    encrypted_vault_key: str  # base64-encoded
    vault_key_nonce: str  # base64-encoded
    public_key: str  # base64-encoded
    pbkdf2_salt: str  # base64-encoded
    hkdf_salt: str  # base64-encoded


# --- Account Self-Service Schemas ---


class DeleteAccountRequest(BaseModel):
    """Request body for account self-deletion. User must type 'DELETE' to confirm."""
    confirmation: str  # Must be "DELETE" to confirm


class DeleteAccountResponse(BaseModel):
    """Response after successful account deletion."""
    message: str
    deleted: bool
