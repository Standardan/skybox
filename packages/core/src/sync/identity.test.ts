import { describe, expect, it } from "vitest";
import { generateSyncIdentity, buildLinkUrl, parseLinkUrl } from "./identity.js";

describe("generateSyncIdentity", () => {
  it("produces distinct syncId and secretKey values across two calls", async () => {
    const a = await generateSyncIdentity();
    const b = await generateSyncIdentity();

    expect(a.syncId).not.toEqual(b.syncId);
    expect(a.secretKey).not.toEqual(b.secretKey);
  });

  it("produces URL-safe, non-empty identifiers", async () => {
    const identity = await generateSyncIdentity();
    expect(identity.syncId.length).toBeGreaterThan(0);
    expect(identity.secretKey.length).toBeGreaterThan(0);
    expect(identity.syncId).not.toMatch(/[+/=]/);
    expect(identity.secretKey).not.toMatch(/[+/=]/);
  });
});

describe("buildLinkUrl / parseLinkUrl", () => {
  it("round-trips a generated identity", async () => {
    const identity = await generateSyncIdentity();
    const url = buildLinkUrl(identity);
    const parsed = parseLinkUrl(url);
    expect(parsed).toEqual(identity);
  });

  it("puts the secret in the URL fragment, not before it", async () => {
    const identity = await generateSyncIdentity();
    const url = buildLinkUrl(identity);
    expect(url.startsWith("skybox://link#")).toBe(true);
    const [prefix] = url.split("#");
    expect(prefix).not.toContain(identity.secretKey);
  });

  it("throws a clear error on a malformed scheme", () => {
    expect(() => parseLinkUrl("https://example.com/link#syncId=a&key=b")).toThrow(/scheme|skybox/i);
  });

  it("throws a clear error when required fields are missing", () => {
    expect(() => parseLinkUrl("skybox://link#syncId=abc")).toThrow(/key/i);
    expect(() => parseLinkUrl("skybox://link#key=abc")).toThrow(/syncId/i);
    expect(() => parseLinkUrl("skybox://link#")).toThrow();
  });

  it("throws on a completely unrelated string", () => {
    expect(() => parseLinkUrl("not a url at all")).toThrow();
  });
});
