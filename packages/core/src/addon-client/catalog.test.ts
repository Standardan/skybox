import { describe, it, expect, vi, afterEach } from "vitest";
import { getCatalog, catalogSearch } from "./catalog.js";
import type { AddonRef } from "../shared/types.js";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
}

function makeAddon(transportUrl: string): AddonRef {
  return { transportUrl, manifest: null, enabled: true, order: 0 };
}

const CINEMETA_CATALOG = {
  metas: [
    {
      id: "tt0111161",
      type: "movie",
      name: "The Shawshank Redemption",
      poster: "https://images.metahub.space/poster/small/tt0111161/img",
      releaseInfo: "1994",
      imdbRating: "9.3",
    },
    {
      id: "tt0068646",
      type: "movie",
      name: "The Godfather",
      poster: "https://images.metahub.space/poster/small/tt0068646/img",
      releaseInfo: "1972",
      imdbRating: "9.2",
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getCatalog", () => {
  it("fetches the plain catalog URL when no extra params are given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CINEMETA_CATALOG));
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://v3-cinemeta.strem.io/manifest.json");
    const metas = await getCatalog(addon, "movie", "top");

    expect(metas).toHaveLength(2);
    expect(metas[0]?.name).toBe("The Shawshank Redemption");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://v3-cinemeta.strem.io/catalog/movie/top.json",
      expect.anything(),
    );
  });

  it("appends a URL-encoded extra segment when extra params are given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ metas: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://v3-cinemeta.strem.io/manifest.json");
    await getCatalog(addon, "movie", "top", { genre: "Sci-Fi", skip: "20" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://v3-cinemeta.strem.io/catalog/movie/top/genre=Sci-Fi&skip=20.json",
      expect.anything(),
    );
  });

  it("URL-encodes special characters in extra values (e.g. search queries)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ metas: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://v3-cinemeta.strem.io/manifest.json");
    await getCatalog(addon, "movie", "top", { search: "the matrix & friends" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://v3-cinemeta.strem.io/catalog/movie/top/search=the%20matrix%20%26%20friends.json",
      expect.anything(),
    );
  });

  it("returns [] when the addon response has no metas field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://v3-cinemeta.strem.io/manifest.json");
    const metas = await getCatalog(addon, "movie", "top");

    expect(metas).toEqual([]);
  });
});

describe("catalogSearch", () => {
  it("wraps getCatalog with a search extra param", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ metas: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const addon = makeAddon("https://v3-cinemeta.strem.io/manifest.json");
    await catalogSearch(addon, "movie", "top", "inception");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://v3-cinemeta.strem.io/catalog/movie/top/search=inception.json",
      expect.anything(),
    );
  });
});
