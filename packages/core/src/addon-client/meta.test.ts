import { describe, it, expect, vi, afterEach } from "vitest";
import { getMeta } from "./meta.js";
import { AddonProtocolError } from "./errors.js";
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

describe("getMeta", () => {
  it("fetches and unwraps the meta object (Cinemeta shape)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        meta: {
          id: "tt0111161",
          type: "movie",
          name: "The Shawshank Redemption",
          poster: "https://images.metahub.space/poster/small/tt0111161/img",
          description: "Two imprisoned men bond over a number of years.",
          runtime: "142 min",
          cast: ["Tim Robbins", "Morgan Freeman"],
          director: ["Frank Darabont"],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://v3-cinemeta.strem.io/manifest.json");
    const meta = await getMeta(addon, "movie", "tt0111161");

    expect(meta.name).toBe("The Shawshank Redemption");
    expect(meta.cast).toContain("Morgan Freeman");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://v3-cinemeta.strem.io/meta/movie/tt0111161.json",
      expect.anything(),
    );
  });

  it("fetches series meta with episode ids that contain colons unmodified", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        meta: {
          id: "tt0903747",
          type: "series",
          name: "Breaking Bad",
          videos: [{ id: "tt0903747:1:1", title: "Pilot", season: 1, episode: 1 }],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://v3-cinemeta.strem.io/manifest.json");
    const meta = await getMeta(addon, "series", "tt0903747");

    expect(meta.videos?.[0]?.id).toBe("tt0903747:1:1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://v3-cinemeta.strem.io/meta/series/tt0903747.json",
      expect.anything(),
    );
  });

  it("throws AddonProtocolError when the response has no meta object", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://v3-cinemeta.strem.io/manifest.json");
    await expect(getMeta(addon, "movie", "tt9999999")).rejects.toThrow(AddonProtocolError);
  });
});
