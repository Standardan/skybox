import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { XtreamCredentials } from "../shared/types.js";
import { buildXtreamStreamUrl, MirrorFailoverError, XtreamClient } from "./xtream-client.js";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const credentials: XtreamCredentials = {
  type: "xtream",
  id: "provider-1",
  label: "Test Provider",
  baseUrls: ["http://example.com:8080"],
  username: "user1",
  password: "pass1",
  hiddenCategories: ["3"],
};

const mirrorCredentials: XtreamCredentials = {
  type: "xtream",
  id: "provider-1",
  label: "Mirrored Provider",
  baseUrls: ["http://dead1.example", "http://dead2.example", "http://good.example"],
  username: "user1",
  password: "pass1",
  hiddenCategories: [],
};

describe("XtreamClient (single mirror)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("validate", () => {
    it("returns true when user_info.auth === 1", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ user_info: { auth: 1 } }));
      const client = new XtreamClient(credentials);

      await expect(client.validate()).resolves.toBe(true);

      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toBe("http://example.com:8080/player_api.php?username=user1&password=pass1");
      expect(client.getActiveBaseUrl()).toBe("http://example.com:8080");
    });

    it("returns false when auth is not 1 (no throw)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ user_info: { auth: 0 } }));
      const client = new XtreamClient(credentials);

      await expect(client.validate()).resolves.toBe(false);
    });

    it("returns false when user_info is missing entirely", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      const client = new XtreamClient(credentials);

      await expect(client.validate()).resolves.toBe(false);
    });

    it("throws (wrapped in MirrorFailoverError) when the only mirror errors", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: "unauthorized" }, { ok: false, status: 401, statusText: "Unauthorized" }),
      );
      const client = new XtreamClient(credentials);

      await expect(client.validate()).rejects.toThrow(MirrorFailoverError);
    });
  });

  describe("getCategories", () => {
    it("maps category_id/category_name and filters hiddenCategories", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
          { category_id: "1", category_name: "News" },
          { category_id: "2", category_name: "Sports" },
          { category_id: "3", category_name: "Adult" },
        ]),
      );
      const client = new XtreamClient(credentials);

      const categories = await client.getCategories();

      expect(categories).toEqual([
        { id: "1", name: "News" },
        { id: "2", name: "Sports" },
      ]);

      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toContain("action=get_live_categories");
    });

    it("hides a category whose id comes back as a JSON number, not just a string", async () => {
      // Real providers are inconsistent about this — sometimes even between
      // their own endpoints — so hiddenCategories (always plain strings,
      // from what getCategories previously returned) must still match a
      // raw number here. This was the actual bug behind "disabling a
      // category doesn't hide its channels": an uncoerced number never
      // matched the stored string in a Set.has() check.
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
          { category_id: 1, category_name: "News" },
          { category_id: 3, category_name: "Adult" },
        ]),
      );
      const client = new XtreamClient({ ...credentials, hiddenCategories: ["3"] });

      const categories = await client.getCategories();

      expect(categories).toEqual([{ id: "1", name: "News" }]);
    });
  });

  describe("getChannels", () => {
    it("maps fields, builds streamUrls, sets streamFormat hls, and filters hidden categories", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
          {
            stream_id: 101,
            name: "News HD",
            stream_icon: "http://example.com/logo.png",
            category_id: "1",
            epg_channel_id: "news.us",
          },
          {
            stream_id: 102,
            name: "Adult Channel",
            stream_icon: "",
            category_id: "3",
            epg_channel_id: null,
          },
        ]),
      );
      const client = new XtreamClient(credentials);

      const channels = await client.getChannels();

      expect(channels).toHaveLength(1);
      expect(channels[0]).toEqual({
        providerId: "provider-1",
        id: "101",
        name: "News HD",
        logo: "http://example.com/logo.png",
        category: "1",
        streamUrls: ["http://example.com:8080/live/user1/pass1/101.m3u8"],
        streamFormat: "hls",
        epgChannelId: "news.us",
      });

      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toContain("action=get_live_streams");
    });

    it("filters out a hidden category even when this endpoint's category_id is a JSON number", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
          { stream_id: 101, name: "News HD", category_id: 1 },
          { stream_id: 102, name: "Adult Channel", category_id: 3 },
        ]),
      );
      const client = new XtreamClient({ ...credentials, hiddenCategories: ["3"] });

      const channels = await client.getChannels();

      expect(channels.map((c) => c.name)).toEqual(["News HD"]);
    });
  });
});

describe("XtreamClient mirror failover", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has no active mirror before any call", () => {
    const client = new XtreamClient(mirrorCredentials);
    expect(client.getActiveBaseUrl()).toBeNull();
  });

  it("falls through dead mirrors and succeeds on the one that answers", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("http://good.example")) {
        return Promise.resolve(jsonResponse({ user_info: { auth: 1 } }));
      }
      return Promise.reject(new TypeError("fetch failed"));
    });

    const client = new XtreamClient(mirrorCredentials);
    await expect(client.validate()).resolves.toBe(true);
    expect(client.getActiveBaseUrl()).toBe("http://good.example");
    // All three mirrors were attempted (no preferred mirror yet, so all raced).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("tries only the last-known-good mirror on the next call (no re-racing dead ones)", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("http://good.example")) {
        return Promise.resolve(jsonResponse({ user_info: { auth: 1 } }));
      }
      return Promise.reject(new TypeError("fetch failed"));
    });
    const client = new XtreamClient(mirrorCredentials);
    await client.validate();
    fetchMock.mockClear();

    fetchMock.mockResolvedValueOnce(jsonResponse([{ category_id: "1", category_name: "News" }]));
    const categories = await client.getCategories();

    expect(categories).toEqual([{ id: "1", name: "News" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]![0] as string).startsWith("http://good.example")).toBe(true);
  });

  it("re-races the full list if the previously-good mirror goes down", async () => {
    let goodIsUp = true;
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("http://good.example") && goodIsUp) {
        return Promise.resolve(jsonResponse({ user_info: { auth: 1 } }));
      }
      if (url.startsWith("http://dead2.example") && !goodIsUp) {
        return Promise.resolve(jsonResponse({ user_info: { auth: 1 } }));
      }
      return Promise.reject(new TypeError("fetch failed"));
    });

    const client = new XtreamClient(mirrorCredentials);
    await client.validate();
    expect(client.getActiveBaseUrl()).toBe("http://good.example");

    goodIsUp = false;
    await client.validate();
    expect(client.getActiveBaseUrl()).toBe("http://dead2.example");
  });

  it("does NOT try other mirrors when a reachable mirror gives a definitive auth:0", async () => {
    // No preferred mirror yet, so all three candidates race concurrently —
    // only the reachable one should resolve; the others reject (unreachable).
    // What matters is that a *reachable-but-wrong-credentials* answer is
    // treated as final, not as "this mirror failed, keep racing."
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("http://dead1.example")) return Promise.resolve(jsonResponse({ user_info: { auth: 0 } }));
      return Promise.reject(new TypeError("fetch failed"));
    });
    const client = new XtreamClient(mirrorCredentials);
    await expect(client.validate()).resolves.toBe(false);
    expect(client.getActiveBaseUrl()).toBe("http://dead1.example");
  });

  it("throws MirrorFailoverError with all candidates listed when every mirror fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const client = new XtreamClient(mirrorCredentials);

    await expect(client.getChannels()).rejects.toThrow(MirrorFailoverError);
    try {
      await client.getChannels();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MirrorFailoverError);
      expect((err as MirrorFailoverError).baseUrls).toEqual(mirrorCredentials.baseUrls);
      expect((err as MirrorFailoverError).causes.length).toBeGreaterThan(0);
    }
  });

  it("getChannels() lists every configured mirror in streamUrls, the one that answered first", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("http://good.example")) {
        return Promise.resolve(jsonResponse([{ stream_id: 55, name: "News HD" }]));
      }
      return Promise.reject(new TypeError("fetch failed"));
    });

    const client = new XtreamClient(mirrorCredentials);
    const channels = await client.getChannels();

    // Same order as baseUrls' declaration, but re-anchored so the mirror
    // that actually answered leads — a mirror reliable for the API isn't
    // necessarily reliable for serving the stream itself, so every
    // candidate needs to be tried, not just this one.
    expect(channels[0]!.streamUrls).toEqual([
      "http://good.example/live/user1/pass1/55.m3u8",
      "http://dead1.example/live/user1/pass1/55.m3u8",
      "http://dead2.example/live/user1/pass1/55.m3u8",
    ]);
  });

  it("throws immediately (before hitting the network) when baseUrls is empty", () => {
    const creds: XtreamCredentials = { ...credentials, baseUrls: [] };
    expect(() => new XtreamClient(creds)).toThrow(/no baseUrls/i);
  });
});

describe("buildXtreamStreamUrl", () => {
  it("builds the HLS (.m3u8) variant by default", () => {
    expect(buildXtreamStreamUrl("http://example.com:8080", "user1", "pass1", 55)).toBe(
      "http://example.com:8080/live/user1/pass1/55.m3u8",
    );
  });

  it("builds the raw TS variant when requested", () => {
    expect(buildXtreamStreamUrl("http://example.com:8080", "user1", "pass1", 55, "ts")).toBe(
      "http://example.com:8080/live/user1/pass1/55.ts",
    );
  });

  it("strips a trailing slash on baseUrl", () => {
    expect(buildXtreamStreamUrl("http://example.com:8080/", "user1", "pass1", 1, "hls")).toBe(
      "http://example.com:8080/live/user1/pass1/1.m3u8",
    );
  });
});
