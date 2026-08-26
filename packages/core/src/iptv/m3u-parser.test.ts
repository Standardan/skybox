import { describe, expect, it } from "vitest";
import { parseM3u } from "./m3u-parser.js";

describe("parseM3u", () => {
  it("parses a realistic multi-channel playlist with mixed/missing attributes", () => {
    const playlist = `#EXTM3U
#EXTINF:-1 tvg-id="news.us" tvg-name="News HD" tvg-logo="http://cdn.example.com/news.png" group-title="News",News HD (US)
http://stream.example.com/live/news/index.m3u8
#EXTINF:-1 tvg-id="sport.us" tvg-name="Sports 1" group-title="Sports",Sports 1
http://stream.example.com/live/sport1/stream.ts
#EXTINF:-1 group-title="Movies",Movie Channel
http://stream.example.com/live/movies/playlist.m3u8
#EXTINF:-1 tvg-id="" tvg-name="Kids Fun" tvg-logo="http://cdn.example.com/kids.png" group-title="Kids",Kids Fun
http://stream.example.com/live/kids/index.m3u8
`;

    const entries = parseM3u(playlist);

    expect(entries).toHaveLength(4);

    expect(entries[0]).toEqual({
      tvgId: "news.us",
      tvgName: "News HD",
      tvgLogo: "http://cdn.example.com/news.png",
      groupTitle: "News",
      displayName: "News HD (US)",
      streamUrl: "http://stream.example.com/live/news/index.m3u8",
    });

    // Missing tvg-logo entirely.
    expect(entries[1]).toEqual({
      tvgId: "sport.us",
      tvgName: "Sports 1",
      tvgLogo: undefined,
      groupTitle: "Sports",
      displayName: "Sports 1",
      streamUrl: "http://stream.example.com/live/sport1/stream.ts",
    });

    // No tvg-id/tvg-name/tvg-logo at all, just group-title and display name.
    expect(entries[2]).toEqual({
      tvgId: undefined,
      tvgName: undefined,
      tvgLogo: undefined,
      groupTitle: "Movies",
      displayName: "Movie Channel",
      streamUrl: "http://stream.example.com/live/movies/playlist.m3u8",
    });

    // Empty-string tvg-id attribute is treated as absent.
    expect(entries[3]!.tvgId).toBeUndefined();
    expect(entries[3]!.tvgName).toBe("Kids Fun");
  });

  it("parses attributes regardless of order", () => {
    const playlist = [
      "#EXTM3U",
      '#EXTINF:-1 group-title="Reordered" tvg-logo="http://cdn.example.com/x.png" tvg-name="X Channel" tvg-id="x.id",X Display',
      "http://stream.example.com/x.m3u8",
    ].join("\n");

    const entries = parseM3u(playlist);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.tvgId).toBe("x.id");
    expect(entries[0]!.tvgName).toBe("X Channel");
    expect(entries[0]!.tvgLogo).toBe("http://cdn.example.com/x.png");
    expect(entries[0]!.groupTitle).toBe("Reordered");
  });

  it("ignores stray #EXT directive lines between EXTINF and the URL", () => {
    const playlist = [
      "#EXTM3U",
      '#EXTINF:-1 tvg-id="a" group-title="A",Channel A',
      "#EXTVLCOPT:network-caching=1000",
      "http://stream.example.com/a.m3u8",
    ].join("\n");

    const entries = parseM3u(playlist);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.streamUrl).toBe("http://stream.example.com/a.m3u8");
  });

  it("returns an empty array for empty input", () => {
    expect(parseM3u("")).toEqual([]);
  });

  it("skips a URL line with no preceding EXTINF", () => {
    const playlist = "#EXTM3U\nhttp://stream.example.com/orphan.m3u8\n";
    expect(parseM3u(playlist)).toEqual([]);
  });
});
