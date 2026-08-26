import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { M3uCredentials } from "../shared/types.js";
import { M3uClient } from "./m3u-client.js";

const FIXTURE = `#EXTM3U
#EXTINF:-1 tvg-id="news.us" tvg-name="News HD" tvg-logo="http://cdn.example.com/news.png" group-title="News",News HD (US)
http://stream.example.com/live/news/index.m3u8
#EXTINF:-1 tvg-id="sport.us" tvg-name="Sports 1" group-title="Sports",Sports 1
http://stream.example.com/live/sport1/stream.ts
#EXTINF:-1 group-title="Adult",Adult Channel
http://stream.example.com/live/adult/index.m3u8
#EXTINF:-1 tvg-name="Weather Now" group-title="News",Weather Now
http://stream.example.com/live/weather/unknownformat
`;

function textResponse(body: string, init: { ok?: boolean; status?: number; statusText?: string } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    text: async () => body,
    json: async () => JSON.parse(body),
  } as Response;
}

const credentials: M3uCredentials = {
  type: "m3u",
  id: "m3u-provider-1",
  label: "Test M3U",
  m3uUrl: "http://example.com/playlist.m3u8",
  hiddenCategories: ["Adult"],
};

describe("M3uClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("validate", () => {
    // A HEAD probe has no body to check even on success (that's normal HTTP
    // behavior, not a failure) — so validate() always follows up with a real
    // GET to check the #EXTM3U signature. HEAD is purely a cheap reachability
    // check before downloading a potentially huge playlist.
    it("probes with HEAD, then confirms via GET, when HEAD succeeds", async () => {
      fetchMock.mockResolvedValueOnce(textResponse("")).mockResolvedValueOnce(textResponse(FIXTURE));
      const client = new M3uClient(credentials);

      await expect(client.validate()).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("HEAD");
      expect((fetchMock.mock.calls[1]![1] as RequestInit).method).toBe("GET");
    });

    it("falls back to GET when HEAD is not supported", async () => {
      fetchMock
        .mockResolvedValueOnce(textResponse("Method Not Allowed", { ok: false, status: 405, statusText: "Method Not Allowed" }))
        .mockResolvedValueOnce(textResponse(FIXTURE));
      const client = new M3uClient(credentials);

      await expect(client.validate()).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("HEAD");
      expect((fetchMock.mock.calls[1]![1] as RequestInit).method).toBe("GET");
    });

    it("returns false when content does not start with #EXTM3U", async () => {
      fetchMock
        .mockResolvedValueOnce(textResponse(""))
        .mockResolvedValueOnce(textResponse("<html>not a playlist</html>"));
      const client = new M3uClient(credentials);

      await expect(client.validate()).resolves.toBe(false);
    });
  });

  describe("getCategories", () => {
    it("collects distinct group-title values, excluding hidden categories", async () => {
      fetchMock.mockResolvedValueOnce(textResponse(FIXTURE));
      const client = new M3uClient(credentials);

      const categories = await client.getCategories();

      expect(categories).toEqual([
        { id: "News", name: "News" },
        { id: "Sports", name: "Sports" },
      ]);
    });
  });

  describe("getChannels", () => {
    it("maps entries to Channel, handling missing logo, ts/m3u8/unknown formats, and hidden categories", async () => {
      fetchMock.mockResolvedValueOnce(textResponse(FIXTURE));
      const client = new M3uClient(credentials);

      const channels = await client.getChannels();

      // Adult Channel filtered out by hiddenCategories.
      expect(channels).toHaveLength(3);

      expect(channels[0]).toEqual({
        providerId: "m3u-provider-1",
        id: expect.any(String),
        name: "News HD",
        logo: "http://cdn.example.com/news.png",
        category: "News",
        streamUrl: "http://stream.example.com/live/news/index.m3u8",
        streamFormat: "hls",
        epgChannelId: "news.us",
      });

      // No tvg-logo present.
      expect(channels[1]!.logo).toBeUndefined();
      expect(channels[1]!.streamFormat).toBe("ts");
      expect(channels[1]!.name).toBe("Sports 1");

      // No tvg-id -> unknown extension in URL.
      expect(channels[2]!.epgChannelId).toBeUndefined();
      expect(channels[2]!.streamFormat).toBe("unknown");
      expect(channels[2]!.name).toBe("Weather Now");
      expect(channels[2]!.category).toBe("News");
    });

    it("produces stable ids across repeated calls for the same content", async () => {
      fetchMock.mockResolvedValueOnce(textResponse(FIXTURE)).mockResolvedValueOnce(textResponse(FIXTURE));
      const client = new M3uClient(credentials);

      const first = await client.getChannels();
      const second = await client.getChannels();

      expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
    });

    it("falls back to the trailing display name when tvg-name is absent", async () => {
      const playlist = `#EXTM3U
#EXTINF:-1 group-title="Movies",Movie Without Tvg Name
http://stream.example.com/movie.m3u8
`;
      fetchMock.mockResolvedValueOnce(textResponse(playlist));
      const client = new M3uClient({ ...credentials, hiddenCategories: [] });

      const channels = await client.getChannels();

      expect(channels).toHaveLength(1);
      expect(channels[0]!.name).toBe("Movie Without Tvg Name");
    });

    it("uses Uncategorized when group-title is missing", async () => {
      const playlist = `#EXTM3U
#EXTINF:-1 tvg-name="No Group",No Group
http://stream.example.com/nogroup.m3u8
`;
      fetchMock.mockResolvedValueOnce(textResponse(playlist));
      const client = new M3uClient({ ...credentials, hiddenCategories: [] });

      const channels = await client.getChannels();

      expect(channels[0]!.category).toBe("Uncategorized");
    });
  });
});
