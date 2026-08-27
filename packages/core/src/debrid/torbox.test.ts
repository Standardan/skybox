import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TorboxClient, TORBOX_API_BASE } from "./torbox.js";
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

const auth: DebridAuth = { provider: "torbox", accessToken: "tb-key-1" };

describe("TorboxClient", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("implements DebridClient with provider 'torbox' and apikey auth", () => {
    const client = new TorboxClient();
    expect(client.provider).toBe("torbox");
    expect(client.authMethod).toBe("apikey");
  });

  it("connectWithApiKey() verifies the key via user/me", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { id: 1, email: "dan@example.com", plan: 1, premium_expires_at: "2027-01-01T00:00:00Z" } }),
    );

    const client = new TorboxClient();
    const result = await client.connectWithApiKey("tb-key-1");

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${TORBOX_API_BASE}/user/me`);
    expect(init.headers.Authorization).toBe("Bearer tb-key-1");
    expect(result).toEqual({ provider: "torbox", accessToken: "tb-key-1" });
  });

  it("getAccountStatus() maps a free account", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 2, email: "free@example.com", plan: 0 } }));

    const client = new TorboxClient();
    const status = await client.getAccountStatus(auth);

    expect(status).toEqual({ username: "free@example.com", premiumUntil: null, type: "free" });
  });

  it("resolveMagnet() creates a torrent, waits for it, then requests a download link", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { torrent_id: 42, hash: "abc" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { id: 42, hash: "abc", download_finished: true, download_present: true, files: [{ id: 7, name: "movie.mkv", size: 789 }] },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true, data: "https://torbox.app/dl/42/7" }));

    const client = new TorboxClient();
    const result = await client.resolveMagnet(auth, "abc");

    expect(mockFetch.mock.calls[2]![0]).toContain("/torrents/requestdl?token=tb-key-1&torrent_id=42&file_id=7");
    expect(result).toEqual({ playableUrl: "https://torbox.app/dl/42/7", filename: "movie.mkv", filesizeBytes: 789 });
  });

  it("resolveMagnet() handles mylist returning an array (not a single object) for ?id=", async () => {
    // TorBox's own published SDKs type this endpoint's response as always
    // an array, even filtered by id -- the docs don't give a concrete
    // example either way. Reading a single-object shape off an array
    // would leave download_finished/download_present silently undefined
    // forever, indistinguishable from "still downloading" until timeout.
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { torrent_id: 42, hash: "abc" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: [
            { id: 99, hash: "other", download_finished: true, download_present: true, files: [] },
            { id: 42, hash: "abc", download_finished: true, download_present: true, files: [{ id: 7, name: "movie.mkv", size: 789 }] },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true, data: "https://torbox.app/dl/42/7" }));

    const client = new TorboxClient();
    const result = await client.resolveMagnet(auth, "abc");

    expect(result).toEqual({ playableUrl: "https://torbox.app/dl/42/7", filename: "movie.mkv", filesizeBytes: 789 });
  });

  it("resolveMagnet() keeps polling through a transient mylist error instead of failing the whole attempt", async () => {
    // Real report this guards against: a torrent that TorBox's own
    // dashboard confirmed had finished got treated as failed and skipped
    // anyway. A single flaky/eventually-consistent poll (e.g. right after
    // createtorrent, before the torrent is visible in mylist yet)
    // shouldn't kill the attempt on the first hiccup.
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { torrent_id: 42, hash: "abc" } }))
      .mockResolvedValueOnce(jsonResponse({ error: "not found yet" }, 404)) // transient
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { id: 42, hash: "abc", download_finished: true, download_present: true, files: [{ id: 7, name: "movie.mkv", size: 789 }] },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true, data: "https://torbox.app/dl/42/7" }));

    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new TorboxClient({ sleep });
    const result = await client.resolveMagnet(auth, "abc");

    expect(result.playableUrl).toBe("https://torbox.app/dl/42/7");
    expect(sleep).toHaveBeenCalledTimes(1); // slept once, between the failed poll and the successful one
  });

  it("resolveMagnet() still throws if mylist keeps failing all the way to the last attempt", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { torrent_id: 42, hash: "abc" } }))
      .mockResolvedValue(jsonResponse({ error: "server error" }, 500));

    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new TorboxClient({ sleep });

    await expect(client.resolveMagnet(auth, "abc")).rejects.toThrow();
  });

  it("unrestrictLink() throws — TorBox has no generic hoster-link unrestrict", async () => {
    const client = new TorboxClient();
    await expect(client.unrestrictLink()).rejects.toThrow(/does not support/);
  });
});
