/**
 * In-memory key lifecycle manager + IndexedDB for Secret Key persistence.
 *
 * SECURITY:
 * - Session keys (AUK, vaultKey, privateKey) are module-scope variables, NEVER exported directly.
 * - They are only accessible through the keyStore getter/setter functions.
 * - On logout or tab close, clearAll() nullifies them for garbage collection.
 * - CryptoKey objects are non-extractable — the browser enforces this.
 * - IndexedDB stores ONLY the encrypted Secret Key (for returning-user convenience).
 * - localStorage and sessionStorage are NEVER used for any key material.
 */

const DB_NAME = 'mikrotik-portal-keys';
const DB_VERSION = 1;
const STORE_NAME = 'secret-keys';

// Module-scope session keys — NEVER in state, localStorage, or sessionStorage
let _auk: CryptoKey | null = null;
let _vaultKey: CryptoKey | null = null;
let _privateKey: CryptoKey | null = null;

export const keyStore = {
  // ---- Session key management (in-memory only) ----

  setAUK(key: CryptoKey): void {
    _auk = key;
  },
  getAUK(): CryptoKey | null {
    return _auk;
  },

  setVaultKey(key: CryptoKey): void {
    _vaultKey = key;
  },
  getVaultKey(): CryptoKey | null {
    return _vaultKey;
  },

  setPrivateKey(key: CryptoKey): void {
    _privateKey = key;
  },
  getPrivateKey(): CryptoKey | null {
    return _privateKey;
  },

  /** Wipe all session keys from memory. Call on logout / tab close. */
  clearAll(): void {
    _auk = null;
    _vaultKey = null;
    _privateKey = null;
  },

  // ---- IndexedDB: encrypted Secret Key for returning users ----

  /** Store an encrypted Secret Key blob for a given email address. */
  async storeSecretKey(
    email: string,
    encryptedSecretKey: Uint8Array,
  ): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      email: email.toLowerCase(),
      data: encryptedSecretKey,
    });
    await txComplete(tx);
    db.close();
  },

  /** Retrieve the encrypted Secret Key for a given email, or null if not found. */
  async getSecretKey(email: string): Promise<Uint8Array | null> {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(email.toLowerCase());
    const result = await new Promise<{ email: string; data: Uint8Array } | undefined>(
      (resolve, reject) => {
        request.onsuccess = () =>
          resolve(request.result as { email: string; data: Uint8Array } | undefined);
        request.onerror = () => reject(request.error);
      },
    );
    db.close();
    return result?.data ?? null;
  },

  /** Check whether an encrypted Secret Key exists for this email on this device. */
  async hasSecretKey(email: string): Promise<boolean> {
    const key = await this.getSecretKey(email);
    return key !== null;
  },

  /** Remove the encrypted Secret Key for a given email. */
  async deleteSecretKey(email: string): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(email.toLowerCase());
    await txComplete(tx);
    db.close();
  },
};

// ---- Internal helpers ----

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'email' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
