/**
 * Two-Secret Key Derivation (2SKD) - 1Password-style key derivation chain.
 *
 * Derives two independent keys from Master Password + Secret Key:
 *   - AUK (Account Unlock Key): AES-256-GCM for data encryption, non-extractable
 *   - SRP-x: 32-byte value for SRP-6a authentication
 *
 * Derivation chain:
 *   1. Stretch PBKDF2 salt via HKDF using email as context
 *   2. PBKDF2-HMAC-SHA256 (650K iterations) on Master Password with stretched salt
 *   3. HKDF on Secret Key using accountId as salt
 *   4. XOR the two 32-byte results to produce the stretched key
 *   5. HKDF-Expand from stretched key with info='auk' -> AUK bits
 *   6. HKDF-Expand from stretched key with info='srp-x' -> SRP-x bits
 *
 * All cryptography uses the browser-native Web Crypto API. Zero npm dependencies.
 */

import type { DeriveKeysParams, DerivedKeys } from './types';

const DEFAULT_ITERATIONS = 650_000;

/**
 * Core derivation logic shared by deriveKeys and deriveKeysRaw.
 * Returns raw byte arrays for both AUK and SRP-x.
 */
async function deriveRawBytes(params: DeriveKeysParams): Promise<{ aukBits: ArrayBuffer; srpBits: ArrayBuffer }> {
  const {
    masterPassword,
    secretKeyBytes,
    email,
    accountId,
    pbkdf2Salt,
    hkdfSalt: _hkdfSalt,
    iterations = DEFAULT_ITERATIONS,
  } = params;

  // Suppress unused variable lint (hkdfSalt reserved for future use; PBKDF2 salt is
  // stretched via HKDF inline below using the email as context)
  void _hkdfSalt;

  const encoder = new TextEncoder();

  // Step 1: Stretch the PBKDF2 salt via HKDF using email as context
  const hkdfSaltKey = await crypto.subtle.importKey(
    'raw',
    pbkdf2Salt.buffer.slice(pbkdf2Salt.byteOffset, pbkdf2Salt.byteOffset + pbkdf2Salt.byteLength) as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits'],
  );
  const stretchedSalt = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: encoder.encode(email.toLowerCase()),
        info: encoder.encode('srp'),
      },
      hkdfSaltKey,
      256,
    ),
  );

  // Step 2: PBKDF2 with 650K iterations on Master Password
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const pbkdf2Result = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: stretchedSalt,
        iterations,
      },
      passwordKey,
      256,
    ),
  );

  // Step 3: HKDF on Secret Key using accountId as salt
  const skKey = await crypto.subtle.importKey(
    'raw',
    secretKeyBytes.buffer.slice(secretKeyBytes.byteOffset, secretKeyBytes.byteOffset + secretKeyBytes.byteLength) as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits'],
  );
  const skDerived = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: encoder.encode(accountId),
        info: encoder.encode('auk'),
      },
      skKey,
      256,
    ),
  );

  // Step 4: XOR the two 32-byte values to produce the stretched key
  const stretched = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    stretched[i] = pbkdf2Result[i]! ^ skDerived[i]!;
  }

  // Step 5: Import stretched key for HKDF-Expand
  const stretchedKey = await crypto.subtle.importKey(
    'raw',
    stretched,
    'HKDF',
    false,
    ['deriveBits'],
  );

  // Step 6: Derive AUK via HKDF-Expand (info='auk')
  const aukBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode('auk'),
    },
    stretchedKey,
    256,
  );

  // Step 7: Derive SRP-x via HKDF-Expand (info='srp-x') - INDEPENDENT from AUK
  const srpBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode('srp-x'),
    },
    stretchedKey,
    256,
  );

  return { aukBits, srpBits };
}

/**
 * Derive AUK (as non-extractable CryptoKey) and SRP-x from Master Password + Secret Key.
 * Runs on whichever thread calls it (main thread or Web Worker).
 */
export async function deriveKeys(params: DeriveKeysParams): Promise<DerivedKeys> {
  const { aukBits, srpBits } = await deriveRawBytes(params);

  // Import AUK as non-extractable AES-256-GCM key
  const auk = await crypto.subtle.importKey(
    'raw',
    aukBits,
    { name: 'AES-GCM', length: 256 },
    false, // CRITICAL: non-extractable
    ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt'],
  );

  return { auk, srpX: new Uint8Array(srpBits) };
}

/**
 * Derive raw AUK bytes and SRP-x bytes (for Web Worker which cannot transfer CryptoKey).
 * The main thread re-imports the raw AUK bytes as a non-extractable CryptoKey.
 */
export async function deriveKeysRaw(
  params: DeriveKeysParams,
): Promise<{ aukRaw: Uint8Array; srpX: Uint8Array }> {
  const { aukBits, srpBits } = await deriveRawBytes(params);
  return {
    aukRaw: new Uint8Array(aukBits),
    srpX: new Uint8Array(srpBits),
  };
}

/**
 * Derive keys in a Web Worker to avoid blocking the UI thread.
 * The Worker computes raw bytes, then the main thread imports AUK as non-extractable CryptoKey.
 *
 * CryptoKey objects cannot be transferred via postMessage when non-extractable,
 * so the Worker returns raw bytes which we re-import here.
 */
export function deriveKeysInWorker(params: DeriveKeysParams): Promise<DerivedKeys> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = async (e: MessageEvent) => {
      const response = e.data as { type: string; aukRaw?: number[]; srpX?: number[]; error?: string };
      if (response.type === 'keysReady' && response.aukRaw && response.srpX) {
        try {
          // Re-import raw AUK bytes as non-extractable CryptoKey on main thread
          const auk = await crypto.subtle.importKey(
            'raw',
            new Uint8Array(response.aukRaw),
            { name: 'AES-GCM', length: 256 },
            false, // CRITICAL: non-extractable
            ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt'],
          );
          resolve({ auk, srpX: new Uint8Array(response.srpX) });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      } else {
        reject(new Error(response.error ?? 'Worker key derivation failed'));
      }
      worker.terminate();
    };

    worker.onerror = (e) => {
      reject(new Error(`Worker error: ${e.message}`));
      worker.terminate();
    };

    worker.postMessage({
      type: 'deriveKeys',
      payload: {
        masterPassword: params.masterPassword,
        secretKeyBytes: Array.from(params.secretKeyBytes),
        email: params.email,
        accountId: params.accountId,
        pbkdf2Salt: Array.from(params.pbkdf2Salt),
        hkdfSalt: Array.from(params.hkdfSalt),
        iterations: params.iterations ?? DEFAULT_ITERATIONS,
      },
    });
  });
}
