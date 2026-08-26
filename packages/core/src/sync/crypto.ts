/**
 * Client-side E2E encryption for sync bundles (docs/07-DECISIONS.md D-008).
 * AES-256-GCM via the Web Crypto API — available natively in Node 20+ and
 * every browser, so no crypto npm dependency is needed and the core module
 * stays framework-free (docs/03-ARCHITECTURE.md).
 *
 * AES-GCM's built-in authentication tag means tampering or a wrong key
 * surfaces as `crypto.subtle.decrypt` throwing (usually `OperationError`).
 * That error is allowed to propagate as-is — callers should not swallow it.
 */

import type { webcrypto } from "node:crypto";
import type { SyncBundle } from "../shared/types.js";
import { toBase64Url, fromBase64Url } from "./base64url.js";

// `CryptoKey` isn't a global type under an ES2022-only `lib` (no DOM). It's
// structurally identical to the browser's `CryptoKey`, so this type-only
// import (no runtime `node:crypto` dependency) keeps this file portable to
// both Node and browser environments.
type CryptoKey = webcrypto.CryptoKey;

const IV_LENGTH_BYTES = 12; // 96-bit IV, the recommended size for AES-GCM

export interface EncryptedBundle {
  iv: string;
  ciphertext: string;
}

async function importSecretKey(
  secretKeyBase64Url: string,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  // Cast pins the buffer type parameter TS 5.7 added to typed arrays —
  // `fromBase64Url`'s `new Uint8Array(n)` is always backed by a plain
  // ArrayBuffer, never SharedArrayBuffer, but that fact isn't visible
  // across this package's DOM-lib-free tsconfig vs. a DOM-lib consumer
  // (e.g. apps/web) type-checking this same source directly.
  const keyBytes = fromBase64Url(secretKeyBase64Url) as Uint8Array<ArrayBuffer>;
  return globalThis.crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [usage]);
}

/** Encrypt a sync bundle under the given secret key. */
export async function encryptBundle(
  bundle: SyncBundle,
  secretKeyBase64Url: string,
): Promise<EncryptedBundle> {
  const key = await importSecretKey(secretKeyBase64Url, "encrypt");

  const iv = new Uint8Array(IV_LENGTH_BYTES);
  globalThis.crypto.getRandomValues(iv);

  const plaintextBytes = new TextEncoder().encode(JSON.stringify(bundle));

  const ciphertextBuffer = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintextBytes,
  );

  return {
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertextBuffer)),
  };
}

/**
 * Decrypt a sync bundle. Throws (naturally, from `crypto.subtle.decrypt`) if
 * the secret key is wrong or the ciphertext/iv has been tampered with —
 * AES-GCM's authentication tag check fails closed.
 */
export async function decryptBundle(
  ciphertext: string,
  iv: string,
  secretKeyBase64Url: string,
): Promise<SyncBundle> {
  const key = await importSecretKey(secretKeyBase64Url, "decrypt");

  const ivBytes = fromBase64Url(iv) as Uint8Array<ArrayBuffer>;
  const ciphertextBytes = fromBase64Url(ciphertext) as Uint8Array<ArrayBuffer>;

  const plaintextBuffer = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    key,
    ciphertextBytes,
  );

  const json = new TextDecoder().decode(plaintextBuffer);
  return JSON.parse(json) as SyncBundle;
}
