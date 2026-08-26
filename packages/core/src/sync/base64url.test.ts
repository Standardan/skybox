import { describe, expect, it } from "vitest";
import { toBase64Url, fromBase64Url } from "./base64url.js";

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 254, 255, 128, 127]);
    const encoded = toBase64Url(bytes);
    const decoded = fromBase64Url(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("round-trips byte sequences of every padding length (0,1,2 remainder bytes)", () => {
    // Lengths 1..8 cover all three base64 padding remainders (len % 3 = 0,1,2)
    for (let len = 1; len <= 8; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 5) % 256;
      const encoded = toBase64Url(bytes);
      // URL-safe: no padding, no +, no /
      expect(encoded).not.toMatch(/[+/=]/);
      const decoded = fromBase64Url(encoded);
      expect(Array.from(decoded)).toEqual(Array.from(bytes));
    }
  });

  it("round-trips 16 random bytes (sync id size) and 32 random bytes (secret key size)", () => {
    const ids = new Uint8Array(16);
    globalThis.crypto.getRandomValues(ids);
    expect(Array.from(fromBase64Url(toBase64Url(ids)))).toEqual(Array.from(ids));

    const key = new Uint8Array(32);
    globalThis.crypto.getRandomValues(key);
    expect(Array.from(fromBase64Url(toBase64Url(key)))).toEqual(Array.from(key));
  });

  it("produces no padding characters even for lengths that would need '=' padding", () => {
    // 1 byte -> standard base64 needs "==" padding; 2 bytes -> needs "="
    const oneByte = toBase64Url(new Uint8Array([0xff]));
    const twoBytes = toBase64Url(new Uint8Array([0xff, 0x01]));
    expect(oneByte.endsWith("=")).toBe(false);
    expect(twoBytes.endsWith("=")).toBe(false);
  });

  it("handles the empty byte array", () => {
    expect(toBase64Url(new Uint8Array(0))).toBe("");
    expect(Array.from(fromBase64Url(""))).toEqual([]);
  });
});
