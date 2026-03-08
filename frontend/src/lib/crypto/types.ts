/**
 * TypeScript interfaces for the zero-knowledge crypto module.
 *
 * These types define the contracts between key derivation, SRP authentication,
 * the Web Worker, and the key store.
 */

/** Parameters for the 2SKD (Two-Secret Key Derivation) chain. */
export interface DeriveKeysParams {
  masterPassword: string;
  secretKeyBytes: Uint8Array; // 16 bytes (128 bits) raw
  email: string;
  accountId: string; // tenant UUID or user UUID for super_admin
  pbkdf2Salt: Uint8Array; // 32 bytes from server
  hkdfSalt: Uint8Array; // 32 bytes from server
  iterations?: number; // default 650000
}

/** Result of key derivation — AUK for encryption, SRP-x for authentication. */
export interface DerivedKeys {
  auk: CryptoKey; // AES-256-GCM, non-extractable
  srpX: Uint8Array; // 32 bytes for SRP verifier computation
}

/** Encrypted key bundle stored server-side during registration. */
export interface KeyBundle {
  encryptedPrivateKey: ArrayBuffer;
  privateKeyNonce: Uint8Array; // 12 bytes
  encryptedVaultKey: ArrayBuffer;
  vaultKeyNonce: Uint8Array; // 12 bytes
  publicKey: ArrayBuffer; // RSA-2048 SPKI format
  pbkdf2Salt: Uint8Array; // 32 bytes
  hkdfSalt: Uint8Array; // 32 bytes
  pbkdf2Iterations: number;
}

/** Message sent from main thread to crypto Web Worker. */
export interface WorkerMessage {
  type: 'deriveKeys';
  payload: {
    masterPassword: string;
    secretKeyBytes: number[]; // Uint8Array serialized as number[] for postMessage
    email: string;
    accountId: string;
    pbkdf2Salt: number[];
    hkdfSalt: number[];
    iterations: number;
  };
}

/** Response from crypto Web Worker back to main thread. */
export interface WorkerResponse {
  type: 'keysReady' | 'error';
  aukRaw?: number[]; // Raw AUK bytes for reimport on main thread
  srpX?: number[]; // Raw SRP-x bytes
  error?: string;
}

/** Result of client-side AES-256-GCM encryption. */
export interface EncryptedPayload {
  ciphertext: Uint8Array;
  nonce: Uint8Array; // 12 bytes
}

/** Payload shape for encrypted config backup transport (JSON-friendly). */
export interface EncryptedBackupPayload {
  encrypted_export: string;  // base64 of packed nonce+ciphertext
  encrypted_binary: string;  // base64 of packed nonce+ciphertext
  encryption_tier: 1;
}
