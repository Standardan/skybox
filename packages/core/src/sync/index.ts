/**
 * `sync` module — E2E-encryption/identity primitives only (docs/07-DECISIONS.md
 * D-017). No relay/transport exists or is planned; each self-hosted instance
 * persists its own config/library. Kept here in case a user's own multi-instance
 * setup wants to encrypt a transferred bundle later — not wired to anything.
 */

export { toBase64Url, fromBase64Url } from "./base64url.js";
export { generateSyncIdentity, buildLinkUrl, parseLinkUrl } from "./identity.js";
export { encryptBundle, decryptBundle } from "./crypto.js";
export type { EncryptedBundle } from "./crypto.js";
