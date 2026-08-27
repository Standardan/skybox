import { describe, it, expect, vi, afterEach } from "vitest";
import {
  aggregateStreams,
  hasLikelyIncompatibleAudio,
  hasLikelyHevcVideo,
  isLikelyUnplayableContainer,
  hasLikelyUnplayableContainerHint,
  matchesPreferredLanguage,
  hasMultipleLanguageTracksHint,
} from "./aggregate.js";
import type { AddonRef, StremioManifest, StremioStream } from "../shared/types.js";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
}

function manifest(id: string, name: string): StremioManifest {
  return { id, name, version: "1.0.0", resources: ["stream"], types: ["movie", "series"], catalogs: [] };
}

function addonRef(transportUrl: string, m: StremioManifest, enabled: boolean, order: number): AddonRef {
  return { transportUrl, manifest: m, enabled, order };
}

const TORRENTIO = addonRef(
  "https://torrentio.strem.fun/manifest.json",
  manifest("com.stremio.torrentio.addon", "Torrentio"),
  true,
  0,
);
const COMET = addonRef("https://comet.example/manifest.json", manifest("comet.fast", "Comet"), true, 1);
const SOOTIO_DISABLED = addonRef(
  "https://sootio.example/manifest.json",
  manifest("sootio.addon", "Sootio"),
  false,
  2,
);
const FLAKY = addonRef(
  "https://flaky.example/manifest.json",
  manifest("flaky.addon", "Flaky"),
  true,
  3,
);

// Torrentio-style: a mix of [RD+]-cached and uncached results at various resolutions.
const TORRENTIO_STREAMS: StremioStream[] = [
  {
    name: "Torrentio\n4k",
    title: "[RD+] Movie.Name.2024.2160p.WEB-DL\n👤 120 💾 8.1 GB",
    url: "https://torrentio.strem.fun/rd/aaa/Movie.2160p.mkv",
  },
  {
    name: "Torrentio\n1080p",
    title: "Movie.Name.2024.1080p.WEBRip\n👤 50 💾 2.1 GB",
    infoHash: "1111111111111111111111111111111111aaaa",
    fileIdx: 0,
  },
  {
    name: "Torrentio\n720p",
    title: "[RD+] Movie.Name.2024.720p.HDTV\n👤 12 💾 900 MB",
    url: "https://torrentio.strem.fun/rd/ccc/Movie.720p.mkv",
  },
];

// Comet-style: one unique cached result, a duplicate infoHash, a duplicate url,
// and a same-url binge-group pair that must survive dedup untouched.
const COMET_STREAMS: StremioStream[] = [
  {
    name: "Comet",
    title: "Movie.Name.2024.1080p.BluRay [PM+]",
    url: "https://comet.example/dl/ddd/Movie.1080p.mkv",
  },
  {
    // Same infoHash+fileIdx as a Torrentio stream — should be deduped away.
    name: "Comet (dup of Torrentio hash)",
    title: "Movie.Name.2024.1080p.WEBRip (found by Comet too)",
    infoHash: "1111111111111111111111111111111111aaaa",
    fileIdx: 0,
  },
  {
    // Same url as a Torrentio stream — should be deduped away.
    name: "Comet (dup of Torrentio url)",
    title: "Movie.Name.2024.2160p.WEB-DL (found by Comet too)",
    url: "https://torrentio.strem.fun/rd/aaa/Movie.2160p.mkv",
  },
  {
    name: "Comet",
    title: "Series.S01E01.720p.WEB-DL",
    url: "https://comet.example/dl/binge/ep.mkv",
    behaviorHints: { bingeGroup: "comet|series1" },
  },
  {
    // Identical url + bingeGroup key as the previous entry — must NOT be
    // collapsed by dedup because it carries a bingeGroup.
    name: "Comet",
    title: "Series.S01E02.720p.WEB-DL",
    url: "https://comet.example/dl/binge/ep.mkv",
    behaviorHints: { bingeGroup: "comet|series1" },
  },
];

function routeFetch(url: string): Response | Promise<Response> {
  if (url.startsWith("https://torrentio.strem.fun/stream/")) {
    return jsonResponse({ streams: TORRENTIO_STREAMS });
  }
  if (url.startsWith("https://comet.example/stream/")) {
    return jsonResponse({ streams: COMET_STREAMS });
  }
  if (url.startsWith("https://flaky.example/stream/")) {
    return Promise.reject(new Error("network timeout"));
  }
  if (url.startsWith("https://sootio.example/stream/")) {
    throw new Error("Sootio is disabled and must not be queried");
  }
  throw new Error(`unexpected fetch: ${url}`);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("aggregateStreams", () => {
  it("queries only enabled addons, tolerates a failing addon, dedupes, and ranks", async () => {
    const fetchMock = vi.fn(async (url: string) => routeFetch(url));
    vi.stubGlobal("fetch", fetchMock);

    const result = await aggregateStreams(
      [TORRENTIO, COMET, SOOTIO_DISABLED, FLAKY],
      "movie",
      "tt1234567",
    );

    // Disabled addon never queried; the other three (incl. the flaky one) were.
    const calledUrls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(calledUrls).toHaveLength(3);
    expect(calledUrls.some((u) => u.includes("sootio.example"))).toBe(false);
    expect(calledUrls.some((u) => u.includes("torrentio.strem.fun"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("comet.example"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("flaky.example"))).toBe(true);

    // 3 Torrentio + 5 Comet = 8 raw; minus 2 true dupes (hash dup, url dup) = 6.
    expect(result).toHaveLength(6);

    // Rank: cached (RD+/PM+) first ordered by resolution (2160p > 1080p > 720p),
    // then uncached ordered by resolution, ties broken by arrival order.
    expect(result[0]?.title).toContain("2160p");
    expect(result[0]?.title).toContain("RD+");

    expect(result[1]?.title).toContain("1080p");
    expect(result[1]?.title).toContain("PM+");

    expect(result[2]?.title).toContain("720p");
    expect(result[2]?.title).toContain("RD+");

    expect(result[3]?.title).toContain("1080p");
    expect(result[3]?.title).not.toContain("RD+");
    expect(result[3]?.title).not.toContain("PM+");

    // The two binge-group entries share a url/dedupe key but both survive,
    // and sort after the uncached 1080p entry since they're 720p/uncached.
    expect(result[4]?.behaviorHints?.bingeGroup).toBe("comet|series1");
    expect(result[5]?.behaviorHints?.bingeGroup).toBe("comet|series1");
    expect(result[4]?.title).toBe("Series.S01E01.720p.WEB-DL");
    expect(result[5]?.title).toBe("Series.S01E02.720p.WEB-DL");

    // sourceAddonId was stamped by getStreams before aggregation.
    expect(result[0]?.sourceAddonId).toBe("com.stremio.torrentio.addon");
    expect(result[1]?.sourceAddonId).toBe("comet.fast");
  });

  it("returns [] when every enabled addon fails", async () => {
    const fetchMock = vi.fn(async () => Promise.reject(new Error("boom")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await aggregateStreams([TORRENTIO, COMET], "movie", "tt0000000");

    expect(result).toEqual([]);
  });

  it("returns [] when addons list has none enabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await aggregateStreams([SOOTIO_DISABLED], "movie", "tt0000000");

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers browser-playable audio as a tiebreaker when cached status and resolution are equal", async () => {
    const streams: StremioStream[] = [
      { name: "A", title: "[RD+] Movie.2024.1080p.BluRay.DTS-HD.MA.x264-GROUP", url: "https://x.example/dts" },
      { name: "B", title: "[RD+] Movie.2024.1080p.BluRay.AAC2.0.x264-GROUP", url: "https://x.example/aac" },
    ];
    const fetchMock = vi.fn(async () => jsonResponse({ streams }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await aggregateStreams([TORRENTIO], "movie", "tt0000000");

    // Both [RD+] and both 1080p — same rank until the audio tiebreaker,
    // which should put the AAC release (browser-decodable) first even
    // though it appeared second in the raw addon response.
    expect(result[0]?.url).toBe("https://x.example/aac");
    expect(result[1]?.url).toBe("https://x.example/dts");
  });
});

describe("hasLikelyIncompatibleAudio", () => {
  it.each([
    "Movie.2024.1080p.BluRay.DTS-HD.MA.x264-GROUP",
    "Movie.2024.2160p.UHD.BluRay.TrueHD.7.1.Atmos.x265-GROUP",
    "Movie.2024.1080p.WEB-DL.DDP5.1.H.264-GROUP",
    "Movie.2024.720p.WEBRip.AC3.5.1.x264-GROUP",
    "Movie.2024.1080p.WEB-DL.EAC3.x264-GROUP",
  ])("flags %s", (title) => {
    expect(hasLikelyIncompatibleAudio({ title } as StremioStream)).toBe(true);
  });

  it.each([
    "Movie.2024.1080p.WEBRip.AAC2.0.x264-GROUP",
    "Movie.2024.720p.WEB-DL.AAC.x264-GROUP",
    "Movie.2024.1080p.BluRay.FLAC.x264-GROUP",
    "Movie.2024.1080p.WEB-DL.MP3.x264-GROUP",
  ])("does not flag %s", (title) => {
    expect(hasLikelyIncompatibleAudio({ title } as StremioStream)).toBe(false);
  });
});

describe("hasLikelyHevcVideo", () => {
  it.each([
    "Movie.2026.2160p.WEB-DL.x265.HDR-DV-GROUP",
    "Movie.2026.2160p.4K.WEB.x265.10bit.AAC5.1-[GROUP]",
    "Movie.2026.1080p.BluRay.H.265-GROUP",
    "Movie.2026.1080p.BluRay.H265-GROUP",
    "Movie 2026 2160p iT WEB-DL DDP5 1 Atmos DV HDR H 265-GROUP", // real release seen in the wild — space, not a dot
    "Movie.2026.2160p.HEVC.10bit-GROUP",
  ])("flags %s", (title) => {
    expect(hasLikelyHevcVideo({ title } as StremioStream)).toBe(true);
  });

  it.each([
    "Movie.2026.1080p.WEBRip.x264-GROUP",
    "Movie.2026.720p.WEB-DL.H.264-GROUP",
    "Movie.2026.1080p.BluRay.AVC-GROUP",
  ])("does not flag %s", (title) => {
    expect(hasLikelyHevcVideo({ title } as StremioStream)).toBe(false);
  });
});

describe("isLikelyUnplayableContainer", () => {
  it.each(["Movie.2024.1080p.mkv", "Movie.2024.720p.avi", "Old.Show.S01E01.wmv", "Clip.flv", "Recording.ts", "Disc.m2ts"])(
    "flags %s",
    (filename) => {
      expect(isLikelyUnplayableContainer(filename)).toBe(true);
    },
  );

  it.each(["Movie.2024.1080p.mp4", "Movie.2024.720p.webm", "Clip.mov", "Movie.2024.m4v"])(
    "does not flag %s",
    (filename) => {
      expect(isLikelyUnplayableContainer(filename)).toBe(false);
    },
  );

  it("is case-insensitive and handles a bare/missing extension safely", () => {
    expect(isLikelyUnplayableContainer("Movie.2024.MKV")).toBe(true);
    expect(isLikelyUnplayableContainer("no-extension-at-all")).toBe(false);
  });
});

describe("hasLikelyUnplayableContainerHint", () => {
  it.each([
    "Movie.2024.1080p.WEB-DL.x264-GROUP.mkv",
    "Movie.2024.720p.avi",
    "Movie.2024.1080p.x264-GROUP.mkv\n👤 40 💾 8 GB",
  ])("flags %s", (title) => {
    expect(hasLikelyUnplayableContainerHint({ title } as StremioStream)).toBe(true);
  });

  it.each([
    "Movie.2024.1080p.WEB-DL.x264-GROUP.mp4",
    "Movie.2024.720p.WEBRip.x264-GROUP",
    "Movie.2024.1080p.x264-GROUP.mp4\n👤 40 💾 8 GB",
  ])("does not flag %s", (title) => {
    expect(hasLikelyUnplayableContainerHint({ title } as StremioStream)).toBe(false);
  });
});

describe("matchesPreferredLanguage", () => {
  it("never filters when preference is 'any'", () => {
    expect(matchesPreferredLanguage({ title: "Movie.2024.FRENCH.1080p" } as StremioStream, "any")).toBe(true);
  });

  it("matches an explicitly-tagged language, and rejects a different explicit tag", () => {
    const french = { title: "Movie.2024.FRENCH.1080p.WEB-DL" } as StremioStream;
    expect(matchesPreferredLanguage(french, "fr")).toBe(true);
    expect(matchesPreferredLanguage(french, "es")).toBe(false);
    expect(matchesPreferredLanguage(french, "en")).toBe(false);
  });

  it("treats an untagged release as English by convention (tags only exist to flag a departure from that default)", () => {
    const untagged = { title: "Movie.2024.1080p.WEB-DL.x264-GROUP" } as StremioStream;
    expect(matchesPreferredLanguage(untagged, "en")).toBe(true);
    expect(matchesPreferredLanguage(untagged, "es")).toBe(false);
  });

  it("treats a MULTI/dual-audio release as matching any specific preference", () => {
    const multi = { title: "Movie.2024.MULTI.1080p.BluRay" } as StremioStream;
    expect(matchesPreferredLanguage(multi, "es")).toBe(true);
    expect(matchesPreferredLanguage(multi, "ja")).toBe(true);

    const dual = { title: "Movie.2024.Dual-Audio.1080p" } as StremioStream;
    expect(matchesPreferredLanguage(dual, "de")).toBe(true);
  });

  it("recognizes flag emoji and native-language spellings, not just English words", () => {
    expect(matchesPreferredLanguage({ title: "Pelicula.2024.Español.1080p" } as StremioStream, "es")).toBe(true);
    expect(matchesPreferredLanguage({ title: "Film.2024.1080p 🇩🇪" } as StremioStream, "de")).toBe(true);
  });
});

describe("hasMultipleLanguageTracksHint", () => {
  it("flags a release tagged with two distinct language flags", () => {
    // Real report: this exact release played in Russian despite an
    // English preference — containing both isn't the same as English
    // being the default track.
    const title = "Obsession (2025) UHD WEB-DL 2160p HDRezka Studio 🇬🇧 / 🇷🇺";
    expect(hasMultipleLanguageTracksHint({ title } as StremioStream)).toBe(true);
  });

  it("flags an explicit MULTI/dual-audio tag even with no specific languages named", () => {
    expect(hasMultipleLanguageTracksHint({ title: "Movie.2024.MULTI.1080p.BluRay" } as StremioStream)).toBe(true);
  });

  it("does not flag a single-language release", () => {
    expect(hasMultipleLanguageTracksHint({ title: "Movie.2024.FRENCH.1080p.WEB-DL" } as StremioStream)).toBe(false);
    expect(hasMultipleLanguageTracksHint({ title: "Movie.2024.1080p.WEB-DL.x264-GROUP" } as StremioStream)).toBe(
      false,
    );
  });
});
