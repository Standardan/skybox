import { describe, it, expect, vi, afterEach } from "vitest";
import { getSubtitles } from "./subtitles.js";
import type { AddonRef } from "../shared/types.js";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
}

function makeAddon(transportUrl: string): AddonRef {
  return { transportUrl, manifest: null, enabled: true, order: 0 };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getSubtitles", () => {
  it("fetches the plain subtitles URL when no extra params are given (SubHero shape)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        subtitles: [
          { id: "sub1", url: "https://subhero.example/subs/tt1234567-en.srt", lang: "eng" },
          { id: "sub2", url: "https://subhero.example/subs/tt1234567-es.srt", lang: "spa" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://subhero.example/manifest.json");
    const subs = await getSubtitles(addon, "movie", "tt1234567");

    expect(subs).toHaveLength(2);
    expect(subs[0]?.lang).toBe("eng");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://subhero.example/subtitles/movie/tt1234567.json",
      expect.anything(),
    );
  });

  it("appends an extra segment (e.g. video hash hint) when given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ subtitles: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://subhero.example/manifest.json");
    await getSubtitles(addon, "movie", "tt1234567", { videoHash: "abc123", videoSize: "1500000" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://subhero.example/subtitles/movie/tt1234567/videoHash=abc123&videoSize=1500000.json",
      expect.anything(),
    );
  });

  it("returns [] when the addon response has no subtitles field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://subhero.example/manifest.json");
    const subs = await getSubtitles(addon, "movie", "tt1234567");

    expect(subs).toEqual([]);
  });
});
