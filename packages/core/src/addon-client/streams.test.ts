import { describe, it, expect, vi, afterEach } from "vitest";
import { getStreams } from "./streams.js";
import { AddonProtocolError } from "./errors.js";
import type { AddonRef, StremioManifest } from "../shared/types.js";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
}

const TORRENTIO_MANIFEST: StremioManifest = {
  id: "com.stremio.torrentio.addon",
  name: "Torrentio",
  version: "0.0.14",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
};

function makeAddon(transportUrl: string, manifest: StremioManifest | null): AddonRef {
  return { transportUrl, manifest, enabled: true, order: 0 };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getStreams", () => {
  it("fetches streams and tags each with sourceAddonId (Torrentio shape)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        streams: [
          {
            name: "Torrentio\n4k",
            title: "Movie.Name.2024.2160p.WEB-DL\n👤 120 💾 8.1 GB",
            infoHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            fileIdx: 0,
          },
          {
            name: "Torrentio\n1080p",
            title: "[RD+] Movie.Name.2024.1080p.WEBRip\n👤 50 💾 2.1 GB",
            url: "https://torrentio.strem.fun/rd/xxxx/Movie.Name.2024.1080p.mkv",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://torrentio.strem.fun/manifest.json", TORRENTIO_MANIFEST);
    const streams = await getStreams(addon, "movie", "tt1234567");

    expect(streams).toHaveLength(2);
    expect(streams.every((s) => s.sourceAddonId === "com.stremio.torrentio.addon")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://torrentio.strem.fun/stream/movie/tt1234567.json",
      expect.anything(),
    );
  });

  it("builds series stream ids with colons unmodified (stream/series/tt...:1:1.json)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ streams: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://torrentio.strem.fun/manifest.json", TORRENTIO_MANIFEST);
    await getStreams(addon, "series", "tt0903747:1:1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://torrentio.strem.fun/stream/series/tt0903747:1:1.json",
      expect.anything(),
    );
  });

  it("returns [] when the addon response has no streams field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://torrentio.strem.fun/manifest.json", TORRENTIO_MANIFEST);
    const streams = await getStreams(addon, "movie", "tt1234567");

    expect(streams).toEqual([]);
  });

  it("throws AddonProtocolError when the addon has no manifest yet", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://torrentio.strem.fun/manifest.json", null);
    await expect(getStreams(addon, "movie", "tt1234567")).rejects.toThrow(AddonProtocolError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
