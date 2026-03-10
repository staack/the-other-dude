/**
 * Secret Key generation and parsing.
 *
 * The Secret Key is a 128-bit CSPRNG value formatted as A3-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXX
 * using a 30-character alphabet (ambiguous characters removed). It is generated client-side
 * and NEVER transmitted to the server.
 *
 * Encoding: 16 bytes (128 bits) -> BigInt -> base-30 -> 27 characters -> grouped with hyphens.
 * 27 chars needed because ceil(128 / log2(30)) = 27 (30^26 < 2^128 < 30^27).
 */

// Uppercase letters minus O, I, L, S (ambiguous) + digits minus 0, 1
// = 22 letters + 8 digits = 30 characters
const CHARSET = 'ABCDEFGHJKMNPQRTUVWXYZ23456789';
const BASE = BigInt(CHARSET.length); // 30n
const KEY_CHAR_LENGTH = 27;
const RAW_BYTE_LENGTH = 16;

/**
 * Generate a new Secret Key with 128 bits of entropy.
 * Returns both the formatted string (for display) and the raw bytes (for derivation).
 */
export function generateSecretKey(): { formatted: string; raw: Uint8Array } {
  const raw = new Uint8Array(RAW_BYTE_LENGTH);
  crypto.getRandomValues(raw);
  const formatted = formatSecretKey(raw);
  return { formatted, raw };
}

/**
 * Encode 16 raw bytes into the A3-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXX format.
 */
export function formatSecretKey(raw: Uint8Array): string {
  // Convert 16 bytes to a BigInt (big-endian)
  let n = 0n;
  for (const byte of raw) {
    n = (n << 8n) | BigInt(byte);
  }

  // Base-30 encode to 27 characters (ceil(128 / log2(30)) = 27)
  const chars: string[] = [];
  for (let i = 0; i < KEY_CHAR_LENGTH; i++) {
    chars.push(CHARSET[Number(n % BASE)]);
    n = n / BASE;
  }

  // Format: A3-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXX
  const keyStr = chars.join('');
  const groups: string[] = [];
  for (let i = 0; i < keyStr.length; i += 6) {
    groups.push(keyStr.slice(i, i + 6));
  }
  return `A3-${groups.join('-')}`;
}

/**
 * Parse a formatted Secret Key back to 16 raw bytes.
 * Returns null if the input is invalid.
 */
export function parseSecretKey(input: string): Uint8Array | null {
  // Strip hyphens, spaces, and normalize to uppercase
  const cleaned = input.replace(/-/g, '').replace(/\s/g, '').toUpperCase();
  if (!cleaned.startsWith('A3')) return null;
  const keyPart = cleaned.slice(2);
  // Accept both old 26-char and new 27-char keys for backward compatibility
  if (keyPart.length < 26) return null;

  // Reverse base-30 encoding: reconstruct the BigInt
  // chars were pushed least-significant first, so index 0 is the lowest digit
  let n = 0n;
  for (let i = keyPart.length - 1; i >= 0; i--) {
    const idx = CHARSET.indexOf(keyPart[i]);
    if (idx === -1) return null;
    n = n * BASE + BigInt(idx);
  }

  // Convert BigInt to 16 bytes (big-endian)
  const bytes = new Uint8Array(RAW_BYTE_LENGTH);
  for (let i = RAW_BYTE_LENGTH - 1; i >= 0; i--) {
    bytes[i] = Number(n & 0xFFn);
    n = n >> 8n;
  }

  return bytes;
}
