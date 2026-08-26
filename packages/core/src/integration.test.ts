/**
 * Cross-module integration test. Unlike each module's own unit tests (which
 * exercise it in isolation with mocked fetch), this simulates one realistic
 * end-to-end user flow through the composed public API in src/index.ts —
 * proving the modules actually interoperate through the shared type contract,
 * not just that each one works alone.
 *
 * Flow: query addon streams -> resolve one via Real-Debrid -> mark it in the
 * library -> separately, fetch today's games -> match a game to the user's
 * IPTV channels using live EPG data -> round-trip the resulting state through
 * the sync encryption layer as a real device-linking transfer would.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aggregateStreams,
  type AddonRef,
  EspnAdapter,
  InMemoryEpgStore,
  matchGameToChannels,
  parseXmltv,
  upsertProgress,
  getContinueWatching,
  generateSyncIdentity,
  encryptBundle,
  decryptBundle,
  type Channel,
  type Config,
  type LibraryItem,
  type SyncBundle,
} from "./index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("integration: addon streams -> library", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("aggregates streams across two addons and records progress in the library", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;

    const torrentio: AddonRef = {
      transportUrl: "https://torrentio.strem.fun",
      manifest: { id: "torrentio", name: "Torrentio", version: "1.0.0", resources: ["stream"], types: ["movie"], catalogs: [] },
      enabled: true,
      order: 0,
    };
    const comet: AddonRef = {
      transportUrl: "https://comet.elfhosted.com",
      manifest: { id: "comet", name: "Comet", version: "1.0.0", resources: ["stream"], types: ["movie"], catalogs: [] },
      enabled: true,
      order: 1,
    };

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          streams: [
            { url: "https://rd.example/a.mkv", title: "Movie.2024.720p\n👤 12 💾 2.1 GB", name: "Torrentio" },
            { url: "https://rd.example/b.mkv", title: "Movie.2024.2160p [RD+]\n👤 40 💾 8 GB", name: "Torrentio" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          streams: [{ url: "https://rd.example/c.mkv", title: "Movie.2024.1080p", name: "Comet" }],
        }),
      );

    const ranked = await aggregateStreams([torrentio, comet], "movie", "tt1234567");

    expect(ranked).toHaveLength(3);
    // The RD+ (cached) 2160p stream should outrank everything else.
    expect(ranked[0]?.url).toBe("https://rd.example/b.mkv");
    expect(ranked.every((s) => s.sourceAddonId === "torrentio" || s.sourceAddonId === "comet")).toBe(true);

    // "Play" the top result: record it in the library as in-progress.
    let library: LibraryItem[] = [];
    library = upsertProgress(library, "tt1234567", "movie", {
      videoId: "tt1234567",
      positionSec: 300,
      durationSec: 7200,
      updatedAt: 1_700_000_000_000,
    });

    const continueWatching = getContinueWatching(library);
    expect(continueWatching).toHaveLength(1);
    expect(continueWatching[0]?.state).toBe("watching");
    expect(continueWatching[0]?.metaId).toBe("tt1234567");
  });
});

describe("integration: sports schedule -> IPTV channel match", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("matches today's ESPN game to the user's IPTV channel via EPG title overlap", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    const startTime = Date.UTC(2026, 7, 25, 20, 15, 0); // 2026-08-25T20:15:00Z

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        events: [
          {
            id: "game-1",
            date: new Date(startTime).toISOString(),
            status: { type: { state: "pre" } },
            competitions: [
              {
                competitors: [
                  { homeAway: "home", team: { displayName: "Philadelphia Eagles", abbreviation: "PHI" } },
                  { homeAway: "away", team: { displayName: "Dallas Cowboys", abbreviation: "DAL" } },
                ],
                broadcasts: [{ names: ["ESPN"] }],
              },
            ],
          },
        ],
      }),
    );

    const adapter = new EspnAdapter("nfl", "football", "nfl");
    const games = await adapter.getSchedule(new Date(startTime));
    expect(games).toHaveLength(1);
    const game = games[0]!;
    expect(game.broadcastNetworks).toEqual(["ESPN"]);

    // The user's real IPTV lineup, from the iptv module's Channel shape.
    const channels: Channel[] = [
      {
        providerId: "my-iptv",
        id: "ch-espn-hd",
        name: "US: ESPN HD",
        category: "Sports",
        streamUrl: "http://iptv.example/live/u/p/501.m3u8",
        streamFormat: "hls",
        epgChannelId: "espn.us",
      },
      {
        providerId: "my-iptv",
        id: "ch-usa",
        name: "US: USA Network",
        category: "Entertainment",
        streamUrl: "http://iptv.example/live/u/p/502.m3u8",
        streamFormat: "hls",
        epgChannelId: "usa.us",
      },
    ];

    // A live XMLTV feed for the ESPN channel, parsed by the epg module.
    const toXmltvTs = (ms: number) => {
      const d = new Date(ms);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
    };
    const xmltv = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="espn.us"><display-name>ESPN HD</display-name></channel>
  <programme start="${toXmltvTs(startTime)}" stop="${toXmltvTs(startTime + 3 * 60 * 60 * 1000)}" channel="espn.us">
    <title>NFL Football: Dallas Cowboys at Philadelphia Eagles</title>
  </programme>
</tv>`;

    const programmes = parseXmltv(xmltv);
    expect(programmes).toHaveLength(1);

    const store = new InMemoryEpgStore();
    store.addProgrammes(programmes);
    const nowNext = store.getNowNext("espn.us", startTime + 1000);
    expect(nowNext.now?.title).toContain("Cowboys");

    const matches = matchGameToChannels(game, channels, programmes, {});
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.channelId).toBe("ch-espn-hd");
    // Both the network-name path and the EPG-title path independently agree.
    expect(matches[0]?.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe("integration: config + library round-trip through sync encryption", () => {
  it("encrypts a real Config+LibraryItem bundle and recovers it byte-for-byte after decryption", async () => {
    const config: Config = {
      addons: [
        {
          transportUrl: "https://torrentio.strem.fun",
          manifest: null,
          enabled: true,
          order: 0,
        },
      ],
      debrid: {
        provider: "real-debrid",
        accessToken: "access-tok",
        refreshToken: "refresh-tok",
        expiresAt: 1_800_000_000_000,
        clientId: "cid",
        clientSecret: "secret",
      },
      iptv: [
        {
          type: "xtream",
          id: "my-iptv",
          label: "My IPTV",
          baseUrls: ["http://iptv.example"],
          username: "user",
          password: "pass",
          hiddenCategories: [],
        },
      ],
      sports: {
        enabled: true,
        leagues: ["nfl"],
        teams: ["Philadelphia Eagles"],
        spoilerFree: false,
        channelOverrides: { "game-1": "ch-espn-hd" },
        teamChannelHints: {},
      },
      ui: { railOrder: ["sports", "continue-watching"], hiddenRails: [], sportsFirst: true },
      playback: { preferCached: true, preferredResolution: "any" },
    };
    const library: LibraryItem[] = [
      { metaId: "tt1234567", type: "movie", state: "watching", progress: { videoId: "tt1234567", positionSec: 300, durationSec: 7200, updatedAt: 1_700_000_000_000 } },
    ];
    const bundle: SyncBundle = { config, library, version: 1, updatedAt: 1_700_000_000_000 };

    const identity = await generateSyncIdentity();
    const encrypted = await encryptBundle(bundle, identity.secretKey);
    const decrypted = await decryptBundle(encrypted.ciphertext, encrypted.iv, identity.secretKey);

    expect(decrypted).toEqual(bundle);
    // Wrong key must not silently decrypt to garbage — it must throw (AES-GCM auth tag).
    const other = await generateSyncIdentity();
    await expect(decryptBundle(encrypted.ciphertext, encrypted.iv, other.secretKey)).rejects.toThrow();
  });
});
