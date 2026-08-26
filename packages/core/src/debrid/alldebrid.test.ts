import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AllDebridClient, ALLDEBRID_API_BASE } from "./alldebrid.js";
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

const auth: DebridAuth = { provider: "alldebrid", accessToken: "apikey-1" };

describe("AllDebridClient", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("implements DebridClient with provider 'alldebrid' and device auth", () => {
    const client = new AllDebridClient();
    expect(client.provider).toBe("alldebrid");
    expect(client.authMethod).toBe("device");
  });

  it("getAuthUrl() requests a pin and packs pin+check into deviceCode", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        status: "success",
        data: { pin: "ABCD", check: "chk-1", expires_in: 600, base_url: "https://alldebrid.com/pin", check_url: "x", user_url: "https://alldebrid.com/pin/ABCD" },
      }),
    );

    const client = new AllDebridClient();
    const result = await client.getAuthUrl();

    expect(mockFetch.mock.calls[0]![0]).toContain(`${ALLDEBRID_API_BASE}/pin/get`);
    expect(result.userCode).toBe("ABCD");
    expect(result.deviceCode).toBe("ABCD:chk-1");
  });

  it("pollForToken() returns a DebridAuth once activated", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: "success", data: { activated: true, expires_in: 500, apikey: "real-key" } }),
    );

    const client = new AllDebridClient();
    const result = await client.pollForToken("ABCD:chk-1", { intervalMs: 0, maxAttempts: 1 });

    expect(result).toEqual({ provider: "alldebrid", accessToken: "real-key" });
  });

  it("getAccountStatus() maps a premium account", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: "success", data: { user: { username: "dan", isPremium: true, premiumUntil: 1_800_000_000 } } }),
    );

    const client = new AllDebridClient();
    const status = await client.getAccountStatus(auth);

    expect(mockFetch.mock.calls[0]![0]).toContain(`${ALLDEBRID_API_BASE}/user`);
    expect(status).toEqual({ username: "dan", premiumUntil: 1_800_000_000_000, type: "premium" });
  });

  it("resolveMagnet() uploads, uses ready files directly, then unlocks the link", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          data: { magnets: [{ id: 1, hash: "abc", ready: true, files: [{ n: "movie.mkv", s: 123, l: "https://alldebrid.com/f/1" }] }] },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "success", data: { link: "https://direct.example/movie.mkv", filename: "movie.mkv", filesize: 123 } }),
      );

    const client = new AllDebridClient();
    const result = await client.resolveMagnet(auth, "abc");

    expect(result).toEqual({ playableUrl: "https://direct.example/movie.mkv", filename: "movie.mkv", filesizeBytes: 123 });
  });
});
