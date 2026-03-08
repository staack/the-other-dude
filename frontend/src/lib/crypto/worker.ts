/**
 * Web Worker entry point for PBKDF2/HKDF key derivation.
 *
 * Runs the expensive 2SKD computation (650K PBKDF2 iterations) off the main thread
 * to prevent UI freezing during login. The Worker returns raw byte arrays which the
 * main thread re-imports as non-extractable CryptoKey objects.
 *
 * CryptoKey objects cannot be transferred via postMessage when non-extractable,
 * so we return raw bytes (serialized as number[]) instead.
 */

import { deriveKeysRaw } from './keys';

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data as {
    type: string;
    payload: {
      masterPassword: string;
      secretKeyBytes: number[];
      email: string;
      accountId: string;
      pbkdf2Salt: number[];
      hkdfSalt: number[];
      iterations: number;
    };
  };

  if (type === 'deriveKeys') {
    try {
      const { aukRaw, srpX } = await deriveKeysRaw({
        masterPassword: payload.masterPassword,
        secretKeyBytes: new Uint8Array(payload.secretKeyBytes),
        email: payload.email,
        accountId: payload.accountId,
        pbkdf2Salt: new Uint8Array(payload.pbkdf2Salt),
        hkdfSalt: new Uint8Array(payload.hkdfSalt),
        iterations: payload.iterations,
      });

      self.postMessage({
        type: 'keysReady',
        aukRaw: Array.from(aukRaw),
        srpX: Array.from(srpX),
      });
    } catch (err) {
      self.postMessage({
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
