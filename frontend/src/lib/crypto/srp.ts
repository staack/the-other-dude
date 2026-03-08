/**
 * Custom SRP-6a client implementation using native BigInt + Web Crypto API.
 *
 * Designed for interop with srptools (Python) server-side library.
 * Uses RFC 5054 2048-bit group parameters with SHA-256 hash.
 *
 * Key conventions for srptools interop:
 *   - All BigNum values are lowercase hex strings (no '0x' prefix)
 *   - Pad BigInt values to N's byte length (256 bytes / 512 hex chars) for hashing
 *   - M1 = H(H(N) XOR H(g) | H(I) | s | A | B | K)
 *   - M2 = H(A | M1 | K)
 *
 * Zero npm dependencies - uses only native BigInt and crypto.subtle.digest.
 */

// ---- RFC 5054 2048-bit Group Parameters ----

// RFC 5054 Appendix A, 2048-bit safe prime (lowercase hex)
const N_HEX =
  'ac6bdb41324a9a9bf166de5e1389582faf72b6651987ee07fc3192943db56050' +
  'a37329cbb4a099ed8193e0757767a13dd52312ab4b03310dcd7f48a9da04fd50' +
  'e8083969edb767b0cf6095179a163ab3661a05fbd5faaae82918a9962f0b93b8' +
  '55f97993ec975eeaa80d740adbf4ff747359d041d5c33ea71d281e446b14773b' +
  'ca97b43a23fb801676bd207a436c6481f1d2b9078717461a5b9d32e688f87748' +
  '544523b524b0d57d5ea77a2775d2ecfa032cfbdbf52fb3786160279004e57ae6' +
  'af874e7303ce53299ccc041c7bc308d82a5698f3a8d0c38271ae35f8e9dbfbb6' +
  '94b5c803d89f7ae435de236d525f54759b65e372fcd68ef20fa7111f9e4aff73';

const N = BigInt('0x' + N_HEX);
const g = 2n;
const N_BYTES = 256; // 2048 bits = 256 bytes
const N_HEX_LEN = N_BYTES * 2; // 512 hex chars

// ---- Utility Functions ----

/** Convert BigInt to lowercase hex string (no prefix, no padding). */
function toHex(n: bigint): string {
  const hex = n.toString(16);
  return hex;
}

/** Pad a hex string to N's byte length (512 hex chars) with leading zeros. */
function padHex(hex: string): string {
  return hex.padStart(N_HEX_LEN, '0');
}

/** Convert BigInt to padded hex bytes (for hash inputs involving N-sized values). */
function bigintToPaddedHex(n: bigint): string {
  return padHex(toHex(n));
}

/** Convert hex string to Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const padded = hex.length % 2 === 1 ? '0' + hex : hex;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Convert Uint8Array to lowercase hex string. */
function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

/** SHA-256 hash of concatenated byte arrays. */
async function H(...inputs: Uint8Array[]): Promise<Uint8Array> {
  // Calculate total length
  let totalLength = 0;
  for (const input of inputs) {
    totalLength += input.length;
  }

  // Concatenate
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const input of inputs) {
    combined.set(input, offset);
    offset += input.length;
  }

  const digest = await crypto.subtle.digest('SHA-256', combined);
  return new Uint8Array(digest);
}

/** Convert BigInt to minimal-length bytes (matches srptools int_to_bytes). */
function bigintToBytes(n: bigint): Uint8Array {
  return hexToBytes(toHex(n));
}

/** Hash BigInt values (unpadded, matching srptools int_to_bytes) and return bytes. */
async function hashBigInt(...values: bigint[]): Promise<Uint8Array> {
  const inputs = values.map((v) => bigintToBytes(v));
  return H(...inputs);
}

/** Pad a BigInt value to N's byte length (256 bytes) matching srptools context.pad(). */
function padBigInt(n: bigint): Uint8Array {
  const bytes = bigintToBytes(n);
  if (bytes.length >= N_BYTES) return bytes;
  const padded = new Uint8Array(N_BYTES);
  padded.set(bytes, N_BYTES - bytes.length);
  return padded;
}

/**
 * Modular exponentiation: base^exp mod mod.
 *
 * Uses Montgomery ladder (constant number of multiplications per bit)
 * for timing resistance against side-channel attacks.
 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 0n) throw new Error('modPow: modulus cannot be zero');
  if (mod === 1n) return 0n;

  base = ((base % mod) + mod) % mod;

  // Montgomery ladder: constant-time per bit
  let r0 = 1n;
  let r1 = base;
  const bits = exp.toString(2);

  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') {
      r0 = (r0 * r1) % mod;
      r1 = (r1 * r1) % mod;
    } else {
      r1 = (r0 * r1) % mod;
      r0 = (r0 * r0) % mod;
    }
  }

  return r0;
}

/** Generate 256 bits of cryptographic randomness as a BigInt. */
function generateRandomBigInt(): bigint {
  const bytes = new Uint8Array(32); // 256 bits
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) {
    n = (n << 8n) | BigInt(b);
  }
  return n;
}

// ---- SRP Client ----

/**
 * SRP-6a client for zero-knowledge authentication.
 *
 * Usage:
 *   1. const client = new SRPClient(email);
 *   2. Send client.getPublicEphemeral() to server in /auth/srp/init
 *   3. Receive server's B and salt
 *   4. const { clientProof, sessionKey } = await client.computeSession(srpX, salt, B)
 *   5. Send clientProof to server in /auth/srp/verify
 *   6. Receive server proof M2
 *   7. await client.verifyServerProof(M2)
 */
export class SRPClient {
  private readonly _N = N;
  private readonly _g = g;
  private readonly _a: bigint; // Client private ephemeral
  private readonly _A: bigint; // Client public ephemeral = g^a mod N
  private readonly _email: string;

  // Set during computeSession, used by verifyServerProof
  private _A_hex = '';
  private _M1: Uint8Array | null = null;
  private _K: Uint8Array | null = null;

  constructor(email: string) {
    this._email = email;

    // Generate random private ephemeral a (256 bits)
    this._a = generateRandomBigInt();

    // Compute public ephemeral A = g^a mod N
    this._A = modPow(this._g, this._a, this._N);

    // SRP spec: if A % N == 0, abort (astronomically unlikely with random a)
    if (this._A % this._N === 0n) {
      throw new Error('SRP: invalid client public ephemeral (A mod N == 0)');
    }
  }

  /** Get the hex-encoded client public ephemeral A to send to the server. */
  getPublicEphemeral(): string {
    const hex = toHex(this._A);
    // Ensure even-length hex for server compatibility
    return hex.length % 2 === 1 ? '0' + hex : hex;
  }

  /**
   * Compute session key and client proof from server parameters.
   *
   * @param srpX - 32-byte SRP-x from 2SKD key derivation
   * @param saltHex - Server-provided SRP salt (hex)
   * @param serverPublicHex - Server-provided public ephemeral B (hex)
   * @returns Client proof M1 (hex) and session key K (32 bytes)
   */
  async computeSession(
    srpX: Uint8Array,
    saltHex: string,
    serverPublicHex: string,
  ): Promise<{ clientProof: string; sessionKey: Uint8Array }> {
    const B = BigInt('0x' + serverPublicHex);

    // SRP spec: if B % N == 0, abort
    if (B % this._N === 0n) {
      throw new Error('SRP: invalid server public ephemeral (B mod N == 0)');
    }

    // Compute k = H(N | PAD(g)) — srptools pads g to N's byte length
    const kHash = await H(bigintToBytes(this._N), padBigInt(this._g));
    const k = BigInt('0x' + bytesToHex(kHash));

    // Compute u = H(PAD(A) | PAD(B)) — srptools pads both to N's byte length
    const uHash = await H(padBigInt(this._A), padBigInt(B));
    const u = BigInt('0x' + bytesToHex(uHash));

    // SRP spec: if u == 0, abort
    if (u === 0n) {
      throw new Error('SRP: invalid scrambling parameter (u == 0)');
    }

    // Convert SRP-x bytes to BigInt
    const x = BigInt('0x' + bytesToHex(srpX));

    // Compute S = (B - k * g^x mod N)^(a + u*x) mod N
    const gx = modPow(this._g, x, this._N);
    const kgx = (k * gx) % this._N;
    // Ensure (B - kgx) is positive by adding N
    const base = ((B - kgx) % this._N + this._N) % this._N;
    const exp = (this._a + u * x) % (this._N - 1n); // Exponent mod (N-1) by Fermat's little theorem extension
    const S = modPow(base, exp, this._N);

    // Compute session key K = H(S) — unpadded, matching srptools
    const K = await H(bigintToBytes(S));
    this._K = K;

    // Compute M1 = H(H(N) XOR H(g) | H(I) | s | A | B | K)
    // All BigInt values use unpadded encoding to match srptools convention
    const hN = await H(bigintToBytes(this._N));
    const hg = await H(bigintToBytes(this._g));

    // XOR H(N) and H(g)
    const hNxorHg = new Uint8Array(hN.length);
    for (let i = 0; i < hN.length; i++) {
      hNxorHg[i] = hN[i]! ^ hg[i]!;
    }

    // H(I) = H(email)
    const hI = await H(new TextEncoder().encode(this._email));

    // Salt as bytes
    const saltBytes = hexToBytes(saltHex);

    // A and B as unpadded bytes (matching srptools int_to_bytes)
    const aHex = toHex(this._A);
    this._A_hex = aHex;
    const bHex = toHex(B);

    const M1 = await H(
      hNxorHg,
      hI,
      saltBytes,
      hexToBytes(aHex),
      hexToBytes(bHex),
      K,
    );
    this._M1 = M1;

    return {
      clientProof: bytesToHex(M1),
      sessionKey: K,
    };
  }

  /**
   * Verify the server's proof M2.
   * Must be called after computeSession().
   *
   * @param serverProofHex - Server-provided M2 proof (hex)
   * @returns true if server proof is valid
   */
  async verifyServerProof(serverProofHex: string): Promise<boolean> {
    if (!this._M1 || !this._K) {
      throw new Error('SRP: computeSession() must be called before verifyServerProof()');
    }

    // M2 = H(A | M1 | K)
    const expectedM2 = await H(
      hexToBytes(this._A_hex),
      this._M1,
      this._K,
    );

    const expectedHex = bytesToHex(expectedM2);
    const actualHex = serverProofHex.toLowerCase();

    // Constant-time comparison (to the extent possible in JS)
    if (expectedHex.length !== actualHex.length) return false;
    let diff = 0;
    for (let i = 0; i < expectedHex.length; i++) {
      diff |= expectedHex.charCodeAt(i) ^ actualHex.charCodeAt(i);
    }
    return diff === 0;
  }
}

/**
 * Compute SRP verifier v = g^x mod N.
 * Used during registration to create the verifier stored on the server.
 *
 * @param srpXHex - Hex-encoded SRP-x from 2SKD key derivation
 * @returns Hex-encoded verifier v (even-length, suitable for Python bytes.fromhex)
 */
export function computeVerifier(srpXHex: string): string {
  const x = BigInt('0x' + srpXHex);
  const v = modPow(g, x, N);
  const hex = toHex(v);
  // Ensure even-length hex for Python bytes.fromhex() compatibility
  return hex.length % 2 === 1 ? '0' + hex : hex;
}
