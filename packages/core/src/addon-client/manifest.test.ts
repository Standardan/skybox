import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchManifest } from "./manifest.js";
import { AddonProtocolError } from "./errors.js";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  const { ok = true, status = 200, statusText = "OK" } = init;
  return {
    ok,
    status,
    statusText,
    json: async () => body,
  } as Response;
}

const CINEMETA_MANIFEST = {
  id: "com.linvo.cinemeta",
  name: "Cinemeta",
  version: "3.0.11",
  description: "The official addon for movies and series",
  resources: ["catalog", "meta"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "top", name: "Popular", extra: [{ name: "genre" }, { name: "skip" }] },
    { type: "series", id: "top", name: "Popular" },
  ],
  idPrefixes: ["tt"],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchManifest", () => {
  it("fetches and returns a valid manifest (Cinemeta shape)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CINEMETA_MANIFEST));
    vi.stubGlobal("fetch", fetchMock);

    const manifest = await fetchManifest("https://v3-cinemeta.strem.io/manifest.json");

    expect(manifest.id).toBe("com.linvo.cinemeta");
    expect(manifest.resources).toEqual(["catalog", "meta"]);
    expect(manifest.catalogs).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://v3-cinemeta.strem.io/manifest.json",
      expect.anything(),
    );
  });

  it("accepts a transportUrl without a manifest.json suffix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CINEMETA_MANIFEST));
    vi.stubGlobal("fetch", fetchMock);

    await fetchManifest("https://v3-cinemeta.strem.io/");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://v3-cinemeta.strem.io/manifest.json",
      expect.anything(),
    );
  });

  it("defaults catalogs to [] when the addon omits it (stream-only addon)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "com.stremio.torrentio.addon",
        name: "Torrentio",
        version: "0.0.14",
        resources: ["stream"],
        types: ["movie", "series"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const manifest = await fetchManifest("https://torrentio.strem.fun/manifest.json");

    expect(manifest.catalogs).toEqual([]);
  });

  it("throws a clear AddonProtocolError on a malformed manifest (missing required fields)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ name: "Broken Addon", resources: ["catalog"] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchManifest("https://broken.example/manifest.json")).rejects.toThrow(
      AddonProtocolError,
    );
    await expect(fetchManifest("https://broken.example/manifest.json")).rejects.toThrow(
      /id, version, types/,
    );
  });

  it("throws a clear AddonProtocolError when the response isn't a JSON object", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse("not an object"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchManifest("https://broken.example/manifest.json")).rejects.toThrow(
      AddonProtocolError,
    );
  });

  it("wraps HTTP failures (e.g. 404) in an AddonProtocolError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(undefined, { ok: false, status: 404, statusText: "Not Found" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchManifest("https://gone.example/manifest.json")).rejects.toThrow(
      AddonProtocolError,
    );
  });
});
