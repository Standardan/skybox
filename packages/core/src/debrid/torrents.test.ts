import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { addMagnet, selectFiles, getTorrentInfo, waitForTorrentDownload, unrestrictLink, resolveMagnet } from "./torrents.js";
import { RD_REST_BASE } from "./constants.js";
import type { DebridAuth } from "../shared/types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function emptyResponse(status = 204): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "No Content",
    json: async () => {
      throw new Error("no body");
    },
    text: async () => "",
  } as unknown as Response;
}

const auth: DebridAuth = {
  provider: "real-debrid",
  accessToken: "access-token-1",
  refreshToken: "refresh-token-1",
  expiresAt: Date.now() + 100_000,
};

const INFO_HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("unrestrictLink", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("maps download/filename/filesize into a DebridResolveResult", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: "link1",
        filename: "Movie.2024.1080p.mkv",
        filesize: 4_294_967_296,
        link: "https://real-debrid.com/d/abc",
        host: "real-debrid.com",
        download: "https://download.real-debrid.com/d/abc/Movie.2024.1080p.mkv",
        streamable: 1,
      }),
    );

    const result = await unrestrictLink(auth, "https://real-debrid.com/d/abc");

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${RD_REST_BASE}/unrestrict/link`);
    expect(init.headers.Authorization).toBe("Bearer access-token-1");
    expect(new URLSearchParams(init.body as string).get("link")).toBe("https://real-debrid.com/d/abc");

    expect(result).toEqual({
      playableUrl: "https://download.real-debrid.com/d/abc/Movie.2024.1080p.mkv",
      filename: "Movie.2024.1080p.mkv",
      filesizeBytes: 4_294_967_296,
    });
  });
});

describe("addMagnet / selectFiles / getTorrentInfo", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("addMagnet posts the magnet uri built from the infoHash", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "tid1", uri: `magnet:?xt=urn:btih:${INFO_HASH}` }));

    const result = await addMagnet(auth, INFO_HASH);

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${RD_REST_BASE}/torrents/addMagnet`);
    expect(new URLSearchParams(init.body as string).get("magnet")).toBe(`magnet:?xt=urn:btih:${INFO_HASH}`);
    expect(result).toEqual({ id: "tid1", uri: `magnet:?xt=urn:btih:${INFO_HASH}` });
  });

  it("selectFiles defaults to files=all when no fileIdx is given, and tolerates an empty response body", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(emptyResponse());

    await expect(selectFiles(auth, "tid1")).resolves.toBeUndefined();

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${RD_REST_BASE}/torrents/selectFiles/tid1`);
    expect(new URLSearchParams(init.body as string).get("files")).toBe("all");
  });

  it("selectFiles sends the specific fileIdx when given", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(emptyResponse());

    await selectFiles(auth, "tid1", 2);

    const [, init] = mockFetch.mock.calls[0]!;
    expect(new URLSearchParams(init.body as string).get("files")).toBe("2");
  });

  it("getTorrentInfo is a plain single GET attempt", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ id: "tid1", filename: "movie.mkv", status: "downloading", links: [] }),
    );

    const info = await getTorrentInfo(auth, "tid1");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(info.status).toBe("downloading");
  });
});

describe("waitForTorrentDownload", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("polls without real waiting until status becomes downloaded", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: "tid1", filename: "f", status: "downloading", links: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: "tid1", filename: "f", status: "downloading", links: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ id: "tid1", filename: "f", status: "downloaded", links: ["https://rd/link1"] }),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    const info = await waitForTorrentDownload(auth, "tid1", { sleep, intervalMs: 1 });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(info.status).toBe("downloaded");
  });

  it("throws on a terminal failure status instead of continuing to poll", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "tid1", filename: "f", status: "error", links: [] }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(waitForTorrentDownload(auth, "tid1", { sleep, intervalMs: 1 })).rejects.toThrow(/error/);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("resolveMagnet (full happy path)", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("chains addMagnet -> selectFiles -> poll info -> unrestrictLink", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch
      // 1. addMagnet
      .mockResolvedValueOnce(jsonResponse({ id: "tid1", uri: `magnet:?xt=urn:btih:${INFO_HASH}` }))
      // 2. selectFiles
      .mockResolvedValueOnce(emptyResponse())
      // 3. torrents/info — still downloading
      .mockResolvedValueOnce(jsonResponse({ id: "tid1", filename: "f", status: "downloading", links: [] }))
      // 4. torrents/info — downloaded, with links
      .mockResolvedValueOnce(
        jsonResponse({
          id: "tid1",
          filename: "Movie.2024.1080p.mkv",
          status: "downloaded",
          links: ["https://real-debrid.com/d/abc"],
        }),
      )
      // 5. unrestrict/link
      .mockResolvedValueOnce(
        jsonResponse({
          id: "link1",
          filename: "Movie.2024.1080p.mkv",
          filesize: 123,
          link: "https://real-debrid.com/d/abc",
          host: "real-debrid.com",
          download: "https://download.real-debrid.com/d/abc/Movie.2024.1080p.mkv",
          streamable: 1,
        }),
      );

    const result = await resolveMagnet(auth, INFO_HASH, undefined, {
      sleep: vi.fn().mockResolvedValue(undefined),
      intervalMs: 1,
    });

    expect(mockFetch).toHaveBeenCalledTimes(5);
    expect(mockFetch.mock.calls[0]![0]).toBe(`${RD_REST_BASE}/torrents/addMagnet`);
    expect(mockFetch.mock.calls[1]![0]).toBe(`${RD_REST_BASE}/torrents/selectFiles/tid1`);
    expect(mockFetch.mock.calls[2]![0]).toBe(`${RD_REST_BASE}/torrents/info/tid1`);
    expect(mockFetch.mock.calls[3]![0]).toBe(`${RD_REST_BASE}/torrents/info/tid1`);
    expect(mockFetch.mock.calls[4]![0]).toBe(`${RD_REST_BASE}/unrestrict/link`);

    expect(result).toEqual({
      playableUrl: "https://download.real-debrid.com/d/abc/Movie.2024.1080p.mkv",
      filename: "Movie.2024.1080p.mkv",
      filesizeBytes: 123,
    });
  });

  it("picks links[fileIdx] when a specific file index was requested", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: "tid2", uri: "magnet:?xt=urn:btih:xyz" }))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          id: "tid2",
          filename: "f",
          status: "downloaded",
          links: ["https://rd/link0", "https://rd/link1", "https://rd/link2"],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "link1",
          filename: "episode2.mkv",
          filesize: 456,
          link: "https://rd/link1",
          host: "real-debrid.com",
          download: "https://download.real-debrid.com/episode2.mkv",
          streamable: 1,
        }),
      );

    const result = await resolveMagnet(auth, "xyz", 1);

    // selectFiles should have been called with files=1
    const selectFilesInit = mockFetch.mock.calls[1]![1];
    expect(new URLSearchParams(selectFilesInit.body as string).get("files")).toBe("1");

    // unrestrict/link should have been called with the link at index 1
    const unrestrictInit = mockFetch.mock.calls[3]![1];
    expect(new URLSearchParams(unrestrictInit.body as string).get("link")).toBe("https://rd/link1");

    expect(result.filename).toBe("episode2.mkv");
  });
});
