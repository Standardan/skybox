import { describe, expect, it } from "vitest";
import type { SyncBundle } from "../shared/types.js";
import { encryptBundle, decryptBundle } from "./crypto.js";
import { generateSyncIdentity } from "./identity.js";
import { toBase64Url } from "./base64url.js";

function sampleBundle(): SyncBundle {
  return {
    config: {
      addons: [
        {
          transportUrl: "https://example.com/manifest.json",
          manifest: null,
          enabled: true,
          order: 0,
        },
      ],
      debrid: {
        provider: "real-debrid",
        accessToken: "tok",
        refreshToken: "refresh",
        expiresAt: 1234567890,
      },
      iptv: [
        {
          type: "xtream",
          id: "prov-1",
          label: "My Provider",
          baseUrls: ["http://iptv.example.com:8080"],
          username: "user",
          password: "pass",
          hiddenCategories: ["adult"],
        },
      ],
      sports: {
        enabled: true,
        leagues: ["nba", "nfl"],
        teams: ["LAL"],
        spoilerFree: false,
        channelOverrides: { "nba-2026-01-01-lal-bos": "espn" },
        teamChannelHints: {},
      },
      ui: {
        railOrder: ["continue-watching", "sports"],
        hiddenRails: [],
        sportsFirst: true,
        timezone: "UTC",
      },
      playback: { preferCached: true, preferredResolution: "any", preferredLanguage: "any" },
    },
    library: [
      {
        metaId: "tt1234567",
        type: "movie",
        state: "watching",
        progress: {
          videoId: "tt1234567",
          positionSec: 120,
          durationSec: 5400,
          updatedAt: 1700000000000,
        },
      },
    ],
    version: 3,
    updatedAt: 1700000000123,
  };
}

describe("encryptBundle / decryptBundle", () => {
  it("round-trips a SyncBundle exactly", async () => {
    const identity = await generateSyncIdentity();
    const bundle = sampleBundle();

    const encrypted = await encryptBundle(bundle, identity.secretKey);
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.ciphertext).toBeTruthy();

    const decrypted = await decryptBundle(encrypted.ciphertext, encrypted.iv, identity.secretKey);
    expect(decrypted).toEqual(bundle);
  });

  it("produces different ciphertext/iv across two encryptions of the same bundle", async () => {
    const identity = await generateSyncIdentity();
    const bundle = sampleBundle();

    const first = await encryptBundle(bundle, identity.secretKey);
    const second = await encryptBundle(bundle, identity.secretKey);

    expect(first.iv).not.toEqual(second.iv);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
  });

  it("throws when decrypting with the wrong secret key", async () => {
    const identity = await generateSyncIdentity();
    const wrongIdentity = await generateSyncIdentity();
    const bundle = sampleBundle();

    const encrypted = await encryptBundle(bundle, identity.secretKey);

    await expect(
      decryptBundle(encrypted.ciphertext, encrypted.iv, wrongIdentity.secretKey),
    ).rejects.toThrow();
  });

  it("throws when the ciphertext has been tampered with", async () => {
    const identity = await generateSyncIdentity();
    const bundle = sampleBundle();

    const encrypted = await encryptBundle(bundle, identity.secretKey);

    // Flip one character in the ciphertext (base64url alphabet only) so the
    // decoded bytes differ but the string stays validly base64url.
    const flipChar = (s: string) => {
      const chars = s.split("");
      const targetIndex = 0;
      const original = chars[targetIndex] as string;
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      const replacement = alphabet[0] === original ? alphabet[1] : alphabet[0];
      chars[targetIndex] = replacement as string;
      return chars.join("");
    };

    const tampered = flipChar(encrypted.ciphertext);
    expect(tampered).not.toEqual(encrypted.ciphertext);

    await expect(decryptBundle(tampered, encrypted.iv, identity.secretKey)).rejects.toThrow();
  });

  it("throws when the IV has been tampered with", async () => {
    const identity = await generateSyncIdentity();
    const bundle = sampleBundle();

    const encrypted = await encryptBundle(bundle, identity.secretKey);

    const ivBytes = new Uint8Array(12);
    ivBytes[0] = 0xff;
    ivBytes[1] = 0xee;
    const tamperedIv = toBase64Url(ivBytes);
    expect(tamperedIv).not.toEqual(encrypted.iv);

    await expect(
      decryptBundle(encrypted.ciphertext, tamperedIv, identity.secretKey),
    ).rejects.toThrow();
  });
});
