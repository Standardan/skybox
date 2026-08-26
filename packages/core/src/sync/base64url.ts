/**
 * Base64url helpers, implemented via a manual byte <-> binary-string loop so
 * behavior is identical in Node and browsers without depending exclusively on
 * either `Buffer` (Node-only) or `btoa`/`atob` (not always base64url-flavored
 * and not present in every JS runtime). Pure functions, no I/O.
 */

const STANDARD_BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Encode raw bytes as a URL-safe, unpadded base64 string. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  const standard = binaryStringToBase64(binary);
  return standard.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode a base64url string (padding optional) back to raw bytes. */
export function fromBase64Url(s: string): Uint8Array {
  let standard = s.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = standard.length % 4;
  if (remainder === 2) standard += "==";
  else if (remainder === 3) standard += "=";
  else if (remainder === 1) {
    throw new Error(`Invalid base64url string: bad length (${s.length})`);
  }
  const binary = base64ToBinaryString(standard);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** binary string -> standard (padded) base64, via manual bit-packing. */
function binaryStringToBase64(binary: string): string {
  let output = "";
  let i = 0;
  for (; i + 3 <= binary.length; i += 3) {
    const b0 = binary.charCodeAt(i);
    const b1 = binary.charCodeAt(i + 1);
    const b2 = binary.charCodeAt(i + 2);
    output += STANDARD_BASE64[b0 >> 2];
    output += STANDARD_BASE64[((b0 & 0x03) << 4) | (b1 >> 4)];
    output += STANDARD_BASE64[((b1 & 0x0f) << 2) | (b2 >> 6)];
    output += STANDARD_BASE64[b2 & 0x3f];
  }
  const remaining = binary.length - i;
  if (remaining === 1) {
    const b0 = binary.charCodeAt(i);
    output += STANDARD_BASE64[b0 >> 2];
    output += STANDARD_BASE64[(b0 & 0x03) << 4];
    output += "==";
  } else if (remaining === 2) {
    const b0 = binary.charCodeAt(i);
    const b1 = binary.charCodeAt(i + 1);
    output += STANDARD_BASE64[b0 >> 2];
    output += STANDARD_BASE64[((b0 & 0x03) << 4) | (b1 >> 4)];
    output += STANDARD_BASE64[(b1 & 0x0f) << 2];
    output += "=";
  }
  return output;
}

/** standard (padded) base64 -> binary string, via manual bit-unpacking. */
function base64ToBinaryString(base64: string): string {
  const clean = base64.replace(/=+$/, "");
  let output = "";
  let i = 0;
  for (; i + 4 <= clean.length; i += 4) {
    const c0 = STANDARD_BASE64.indexOf(clean[i] as string);
    const c1 = STANDARD_BASE64.indexOf(clean[i + 1] as string);
    const c2 = STANDARD_BASE64.indexOf(clean[i + 2] as string);
    const c3 = STANDARD_BASE64.indexOf(clean[i + 3] as string);
    output += String.fromCharCode((c0 << 2) | (c1 >> 4));
    output += String.fromCharCode(((c1 & 0x0f) << 4) | (c2 >> 2));
    output += String.fromCharCode(((c2 & 0x03) << 6) | c3);
  }
  const remaining = clean.length - i;
  if (remaining === 2) {
    const c0 = STANDARD_BASE64.indexOf(clean[i] as string);
    const c1 = STANDARD_BASE64.indexOf(clean[i + 1] as string);
    output += String.fromCharCode((c0 << 2) | (c1 >> 4));
  } else if (remaining === 3) {
    const c0 = STANDARD_BASE64.indexOf(clean[i] as string);
    const c1 = STANDARD_BASE64.indexOf(clean[i + 1] as string);
    const c2 = STANDARD_BASE64.indexOf(clean[i + 2] as string);
    output += String.fromCharCode((c0 << 2) | (c1 >> 4));
    output += String.fromCharCode(((c1 & 0x0f) << 4) | (c2 >> 2));
  } else if (remaining === 1) {
    throw new Error("Invalid base64 string: dangling single character");
  }
  return output;
}
