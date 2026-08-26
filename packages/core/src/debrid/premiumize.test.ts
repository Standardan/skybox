import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PremiumizeClient, PREMIUMIZE_API_BASE } from "./premiumize.js";
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

const auth: DebridAuth = { provider: "premiumize", accessToken: "pm-key-1" };

describe("PremiumizeClient", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("implements DebridClient with provider 'premiumize' and apikey auth", () => {
    const client = new PremiumizeClient();
    expect(client.provider).toBe("premiumize");
    expect(client.authMethod).toBe("apikey");
  });

  it("connectWithApiKey() verifies the key via account/info and returns a DebridAuth", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    const now = 1_750_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: "success", customer_id: "cust-1", premium_until: Math.floor(now / 1000) + 86_400 }),
    );

    const client = new PremiumizeClient();
    const result = await client.connectWithApiKey("pm-key-1");

    expect(mockFetch.mock.calls[0]![0]).toBe(`${PREMIUMIZE_API_BASE}/account/info?apikey=pm-key-1`);
    expect(result).toEqual({ provider: "premiumize", accessToken: "pm-key-1" });
    vi.useRealTimers();
  });

  it("connectWithApiKey() throws on an invalid key", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: "error", message: "invalid apikey" }));

    const client = new PremiumizeClient();
    await expect(client.connectWithApiKey("bad-key")).rejects.toThrow(/invalid apikey/);
  });

  it("resolveMagnet() posts to transfer/directdl and returns the first cached link", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        status: "success",
        content: [{ path: "Movie/movie.mkv", size: 456, link: "https://premiumize.me/dl/1", stream_link: "https://premiumize.me/stream/1" }],
      }),
    );

    const client = new PremiumizeClient();
    const result = await client.resolveMagnet(auth, "abc123");

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${PREMIUMIZE_API_BASE}/transfer/directdl`);
    expect(init.body).toContain("apikey=pm-key-1");
    expect(init.body).toContain("magnet%3A");
    expect(result).toEqual({ playableUrl: "https://premiumize.me/stream/1", filename: "movie.mkv", filesizeBytes: 456 });
  });

  it("resolveMagnet() throws a clear error when the source isn't cached", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: "error", message: "not cached" }));

    const client = new PremiumizeClient();
    await expect(client.resolveMagnet(auth, "abc123")).rejects.toThrow(/not cached/);
  });
});
