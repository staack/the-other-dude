/**
 * Client-side registration flow for zero-knowledge SRP authentication.
 *
 * Generates all cryptographic material locally:
 *   1. Secret Key (128-bit CSPRNG, never sent to server)
 *   2. SRP salt + verifier (derived from 2SKD chain)
 *   3. RSA-2048 keypair (private key wrapped with AUK)
 *   4. Tenant vault key (wrapped with AUK)
 *
 * The Secret Key is returned to the caller for display in the Emergency Kit dialog.
 * It is NEVER included in any server request.
 */

import { generateSecretKey } from './secretKey';
import { deriveKeysInWorker } from './keys';
import { computeVerifier } from './srp';

/**
 * Check if the Web Crypto API is available (requires secure context: HTTPS or localhost).
 * Throws a user-friendly error if not.
 */
export function assertWebCryptoAvailable(): void {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'Your browser requires a secure connection (HTTPS) for encryption features. ' +
      'Please access this application via HTTPS or localhost.',
    );
  }
}

export interface RegistrationResult {
  /** Formatted Secret Key (A3-XXXXXX-...) for display in Emergency Kit */
  secretKey: string;
  /** Raw Secret Key bytes for IndexedDB storage */
  secretKeyRaw: Uint8Array;
  /** SRP registration data to send to server */
  srpRegistration: {
    srp_salt: string; // hex
    srp_verifier: string; // hex
  };
  /** Encrypted key bundle to send to server */
  keyBundle: {
    encrypted_private_key: string; // base64
    private_key_nonce: string; // base64
    encrypted_vault_key: string; // base64
    vault_key_nonce: string; // base64
    public_key: string; // base64
    pbkdf2_salt: string; // base64
    hkdf_salt: string; // base64
  };
}

/** Convert an ArrayBuffer or Uint8Array to a base64 string. */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Convert a Uint8Array to a lowercase hex string. */
function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Perform full client-side registration: generate Secret Key, derive SRP
 * credentials, create and wrap RSA keypair and vault key.
 *
 * @param email - User's email address
 * @param masterPassword - User's chosen master password
 * @returns Registration result with Secret Key (for display) and server payloads
 */
export async function performRegistration(
  email: string,
  masterPassword: string,
): Promise<RegistrationResult> {
  // 0. Verify Web Crypto API is available (requires HTTPS or localhost)
  assertWebCryptoAvailable();

  // 1. Generate Secret Key (128-bit, client-only)
  const { formatted: secretKey, raw: secretKeyRaw } = generateSecretKey();

  // 2. Generate random salts
  const pbkdf2Salt = crypto.getRandomValues(new Uint8Array(32));
  const hkdfSalt = crypto.getRandomValues(new Uint8Array(32));

  // 3. Derive AUK + SRP-x via Web Worker (avoids blocking UI)
  const { auk, srpX } = await deriveKeysInWorker({
    masterPassword,
    secretKeyBytes: secretKeyRaw,
    email,
    accountId: email,
    pbkdf2Salt,
    hkdfSalt,
  });

  // 4. Generate SRP salt and compute verifier
  const srpSalt = crypto.getRandomValues(new Uint8Array(32));
  const srpSaltHex = toHex(srpSalt);
  const srpXHex = toHex(srpX);
  // Compute verifier: v = g^x mod N
  const verifierHex = computeVerifier(srpXHex);

  // 5. Generate RSA-2048 keypair
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true, // extractable=true needed for wrapKey export
    ['encrypt', 'decrypt'],
  );

  // 6. Export public key (SPKI format)
  const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey);

  // 7. Wrap private key with AUK (AES-GCM)
  const privateKeyNonce = crypto.getRandomValues(new Uint8Array(12));
  const wrappedPrivateKey = await crypto.subtle.wrapKey(
    'pkcs8',
    keyPair.privateKey,
    auk,
    { name: 'AES-GCM', iv: privateKeyNonce },
  );

  // 8. Generate tenant vault key (AES-256-GCM)
  // For new users, generate a random vault key.
  // In a multi-user tenant, this would be the existing tenant vault key
  // encrypted with this user's public key. For now, generate fresh.
  const vaultKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable for wrapping
    ['encrypt', 'decrypt'],
  );

  // 9. Wrap vault key with AUK (AES-GCM)
  const vaultKeyNonce = crypto.getRandomValues(new Uint8Array(12));
  const wrappedVaultKey = await crypto.subtle.wrapKey('raw', vaultKey, auk, {
    name: 'AES-GCM',
    iv: vaultKeyNonce,
  });

  // 10. Base64 encode all binary data for transport
  return {
    secretKey,
    secretKeyRaw,
    srpRegistration: {
      srp_salt: srpSaltHex,
      srp_verifier: verifierHex,
    },
    keyBundle: {
      encrypted_private_key: toBase64(wrappedPrivateKey),
      private_key_nonce: toBase64(privateKeyNonce),
      encrypted_vault_key: toBase64(wrappedVaultKey),
      vault_key_nonce: toBase64(vaultKeyNonce),
      public_key: toBase64(publicKeyBuffer),
      pbkdf2_salt: toBase64(pbkdf2Salt),
      hkdf_salt: toBase64(hkdfSalt),
    },
  };
}
