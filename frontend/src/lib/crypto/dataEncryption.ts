/**
 * Client-side data encryption module for tenant data.
 *
 * Encrypts/decrypts config backups, audit log details, and report content
 * using the vault key (AES-256-GCM CryptoKey) already held in keyStore.
 *
 * Wire format: [12-byte nonce][ciphertext + 16-byte GCM tag]
 * Transport encoding: base64 of the wire format for JSON payloads.
 *
 * SECURITY:
 * - ALWAYS uses crypto.getRandomValues() (CSPRNG) for nonce generation
 * - NEVER reuses nonces -- each encrypt call generates a fresh 12-byte random nonce
 * - All CryptoKey objects are non-extractable (enforced at import time in keyStore)
 * - No npm dependencies -- Web Crypto API only
 */

import type { EncryptedPayload } from './types';

const NONCE_BYTES = 12;

// ---- Base64 helpers (browser-native, no npm) ----

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---- Core encryption / decryption ----

/**
 * Encrypt arbitrary data using AES-256-GCM with the vault key.
 * Generates a random 12-byte nonce per call (CSPRNG).
 */
export async function encryptForStorage(
  data: Uint8Array,
  vaultKey: CryptoKey,
): Promise<EncryptedPayload> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      vaultKey,
      data as BufferSource,
    ),
  );
  return { ciphertext, nonce };
}

/**
 * Decrypt AES-256-GCM encrypted data using the vault key and nonce.
 */
export async function decryptFromStorage(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  vaultKey: CryptoKey,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    vaultKey,
    ciphertext as BufferSource,
  );
  return new Uint8Array(plaintext);
}

// ---- Pack / unpack for wire transport ----

/**
 * Concatenate nonce (12 bytes) + ciphertext for transport.
 * Format: [12-byte nonce][ciphertext + 16-byte GCM tag]
 */
export function packEncrypted(nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const packed = new Uint8Array(nonce.length + ciphertext.length);
  packed.set(nonce, 0);
  packed.set(ciphertext, nonce.length);
  return packed;
}

/**
 * Split packed format back into nonce and ciphertext.
 */
export function unpackEncrypted(packed: Uint8Array): { nonce: Uint8Array; ciphertext: Uint8Array } {
  if (packed.length < NONCE_BYTES + 1) {
    throw new Error(`Packed data too short: expected at least ${NONCE_BYTES + 1} bytes, got ${packed.length}`);
  }
  return {
    nonce: packed.slice(0, NONCE_BYTES),
    ciphertext: packed.slice(NONCE_BYTES),
  };
}

// ---- Convenience: text ----

/**
 * Encode text to UTF-8, encrypt, pack, and return as base64 string (for JSON transport).
 */
export async function encryptText(text: string, vaultKey: CryptoKey): Promise<string> {
  const data = new TextEncoder().encode(text);
  const { ciphertext, nonce } = await encryptForStorage(data, vaultKey);
  return uint8ToBase64(packEncrypted(nonce, ciphertext));
}

/**
 * Decode base64, unpack, decrypt, and return as UTF-8 string.
 */
export async function decryptText(base64Encrypted: string, vaultKey: CryptoKey): Promise<string> {
  const packed = base64ToUint8(base64Encrypted);
  const { nonce, ciphertext } = unpackEncrypted(packed);
  const plaintext = await decryptFromStorage(ciphertext, nonce, vaultKey);
  return new TextDecoder().decode(plaintext);
}

// ---- Convenience: binary ----

/**
 * Encrypt binary data and return packed result as base64 string.
 */
export async function encryptBinary(data: Uint8Array, vaultKey: CryptoKey): Promise<string> {
  const { ciphertext, nonce } = await encryptForStorage(data, vaultKey);
  return uint8ToBase64(packEncrypted(nonce, ciphertext));
}

/**
 * Decode base64, unpack, decrypt, and return raw bytes.
 */
export async function decryptBinary(base64Encrypted: string, vaultKey: CryptoKey): Promise<Uint8Array> {
  const packed = base64ToUint8(base64Encrypted);
  const { nonce, ciphertext } = unpackEncrypted(packed);
  return decryptFromStorage(ciphertext, nonce, vaultKey);
}
