/**
 * Client-side text diff computation utilities.
 *
 * Used for computing diffs on encrypted config backups where the server
 * cannot see plaintext. Handles mixed encryption tiers:
 *   - Tier 1: Client-side encrypted -- decrypt with vault key, then diff
 *   - Tier 2: Transit encrypted -- server decrypts for us, plaintext arrives
 *   - NULL:   Legacy plaintext -- use as-is
 *
 * The existing ConfigDiffViewer uses @git-diff-view/react which takes raw
 * oldText/newText strings. These utilities provide the decrypted text strings
 * for that component, plus a line-based diff for summary counts.
 */

import { diffLines } from 'diff';
import { decryptText } from './crypto/dataEncryption';

/** A single diff change (matches the `Change` type from the `diff` package). */
export interface DiffResult {
  value: string;
  added?: boolean;
  removed?: boolean;
  count?: number;
}

/**
 * Compute a line-based diff between two plaintext strings.
 * Returns an array of DiffResult objects compatible with the `diff` package's Change type.
 */
export function computeConfigDiff(oldText: string, newText: string): DiffResult[] {
  return diffLines(oldText, newText);
}

/**
 * Decrypt (if needed) and compute a diff between two config versions.
 *
 * Handles mixed encryption tiers:
 *   - Tier 1 (client-side encrypted): decrypt with vault key first
 *   - Tier 2 (transit encrypted): server already sent plaintext
 *   - NULL (legacy plaintext): use as-is
 *
 * @param oldEncrypted - Old config text (may be base64-encrypted for Tier 1)
 * @param oldTier - Encryption tier of old version (1, 2, or null)
 * @param newEncrypted - New config text (may be base64-encrypted for Tier 1)
 * @param newTier - Encryption tier of new version (1, 2, or null)
 * @param vaultKey - AES-256-GCM vault key for Tier 1 decryption
 */
export async function computeEncryptedConfigDiff(
  oldEncrypted: string,
  oldTier: number | null,
  newEncrypted: string,
  newTier: number | null,
  vaultKey: CryptoKey,
): Promise<DiffResult[]> {
  const oldText = await decryptByTier(oldEncrypted, oldTier, vaultKey);
  const newText = await decryptByTier(newEncrypted, newTier, vaultKey);
  return computeConfigDiff(oldText, newText);
}

/**
 * Decrypt text based on encryption tier and return plaintext for diff.
 *
 * @param oldEncrypted - Old config text (may be base64-encrypted for Tier 1)
 * @param oldTier - Encryption tier (1, 2, or null)
 * @param newEncrypted - New config text (may be base64-encrypted for Tier 1)
 * @param newTier - Encryption tier (1, 2, or null)
 * @param vaultKey - AES-256-GCM vault key for Tier 1 decryption
 * @returns Object with decrypted oldText and newText strings
 */
export async function decryptForDiff(
  oldEncrypted: string,
  oldTier: number | null,
  newEncrypted: string,
  newTier: number | null,
  vaultKey: CryptoKey,
): Promise<{ oldText: string; newText: string }> {
  const oldText = await decryptByTier(oldEncrypted, oldTier, vaultKey);
  const newText = await decryptByTier(newEncrypted, newTier, vaultKey);
  return { oldText, newText };
}

/**
 * Count added and removed lines from a diff result array.
 * Replaces server-side compute_line_delta for Tier 1 backups
 * where the server cannot see plaintext.
 */
export function computeLineCounts(diffs: DiffResult[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const diff of diffs) {
    const lineCount = diff.count ?? diff.value.split('\n').filter(Boolean).length;
    if (diff.added) {
      added += lineCount;
    } else if (diff.removed) {
      removed += lineCount;
    }
  }
  return { added, removed };
}

// ---- Internal ----

/**
 * Decrypt a single text value based on its encryption tier.
 */
async function decryptByTier(
  text: string,
  tier: number | null,
  vaultKey: CryptoKey,
): Promise<string> {
  if (tier === 1) {
    // Tier 1: Client-side encrypted -- decrypt with vault key
    return decryptText(text, vaultKey);
  }
  // Tier 2 or NULL: plaintext (server decrypted or never encrypted)
  return text;
}
