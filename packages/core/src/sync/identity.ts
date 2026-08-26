/**
 * Sync identity generation and link-URL encode/decode.
 *
 * See docs/03-ARCHITECTURE.md "Sync design (no accounts)" and
 * docs/07-DECISIONS.md D-008: a random sync ID addresses the (opaque, server
 * stored) blob; a client-held secret key never leaves the client except
 * inside a URL *fragment* (never sent to any server, never logged).
 */

import type { SyncIdentity } from "../shared/types.js";
import { toBase64Url, fromBase64Url } from "./base64url.js";

const LINK_SCHEME = "skybox://link";

/**
 * Generate a fresh sync identity: a URL-safe random sync ID and a 256-bit
 * secret key. Both come straight from `crypto.getRandomValues` — never
 * derived from anything guessable (timestamps, device info, etc).
 */
export async function generateSyncIdentity(): Promise<SyncIdentity> {
  const idBytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(idBytes);
  const syncId = toBase64Url(idBytes);

  const keyBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(keyBytes);
  const secretKey = toBase64Url(keyBytes);

  return { syncId, secretKey };
}

/**
 * Build a device-linking URL carrying the sync identity in the URL
 * *fragment* (`#...`), so the secret never appears in anything a server
 * would log (query strings, request paths).
 */
export function buildLinkUrl(identity: SyncIdentity): string {
  const params = new URLSearchParams({
    syncId: identity.syncId,
    key: identity.secretKey,
  });
  return `${LINK_SCHEME}#${params.toString()}`;
}

/**
 * Parse a link URL produced by {@link buildLinkUrl} back into a
 * {@link SyncIdentity}. Throws a descriptive error if the URL doesn't match
 * the expected scheme/shape.
 */
export function parseLinkUrl(url: string): SyncIdentity {
  if (typeof url !== "string" || !url.startsWith(`${LINK_SCHEME}#`)) {
    throw new Error(
      `Invalid sync link URL: expected it to start with "${LINK_SCHEME}#", got: ${String(url)}`,
    );
  }

  const fragment = url.slice(LINK_SCHEME.length + 1);
  const params = new URLSearchParams(fragment);

  const syncId = params.get("syncId");
  const secretKey = params.get("key");

  if (!syncId) {
    throw new Error(`Invalid sync link URL: missing "syncId" in fragment: ${url}`);
  }
  if (!secretKey) {
    throw new Error(`Invalid sync link URL: missing "key" in fragment: ${url}`);
  }

  // Validate the pieces are well-formed base64url so a corrupted/truncated
  // link fails fast here rather than deep inside AES-GCM later.
  try {
    fromBase64Url(syncId);
  } catch {
    throw new Error(`Invalid sync link URL: "syncId" is not valid base64url: ${syncId}`);
  }
  try {
    fromBase64Url(secretKey);
  } catch {
    throw new Error(`Invalid sync link URL: "key" is not valid base64url: ${secretKey}`);
  }

  return { syncId, secretKey };
}
