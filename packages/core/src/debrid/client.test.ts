import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RealDebridClient } from "./client.js";
import { RD_OAUTH_BASE, RD_REST_BASE, RD_OPEN_SOURCE_CLIENT_ID } from "./constants.js";
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

describe("RealDebridClient", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("implements DebridClient with provider 'real-debrid'", () => {
    const client = new RealDebridClient();
    expect(client.provider).toBe("real-debrid");
  });

  it("getAuthUrl() delegates to the device code request using the configured client id", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        device_code: "dc",
        user_code: "UC",
        interval: 5,
        expires_in: 1800,
        verification_url: "https://real-debrid.com/device",
      }),
    );

    const client = new RealDebridClient();
    const result = await client.getAuthUrl();

    expect(mockFetch.mock.calls[0]![0]).toContain(`${RD_OAUTH_BASE}/device/code`);
    expect(mockFetch.mock.calls[0]![0]).toContain(`client_id=${RD_OPEN_SOURCE_CLIENT_ID}`);
    expect(result.deviceCode).toBe("dc");
    expect(result.userCode).toBe("UC");
  });

  it("getAccountStatus() delegates through to GET /user", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1, username: "dan", premium: 3600 }));

    const client = new RealDebridClient();
    const auth: DebridAuth = {
      provider: "real-debrid",
      accessToken: "tok",
      refreshToken: "reftok",
      expiresAt: Date.now() + 1000,
    };
    const status = await client.getAccountStatus(auth);

    expect(mockFetch.mock.calls[0]![0]).toBe(`${RD_REST_BASE}/user`);
    expect(status.username).toBe("dan");
    expect(status.type).toBe("premium");
  });

  it("refreshAccessToken() (extra helper) delegates to the oauth refresh flow", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ access_token: "new", refresh_token: "newref", expires_in: 3600, token_type: "Bearer" }),
    );

    const client = new RealDebridClient();
    const auth: DebridAuth = {
      provider: "real-debrid",
      accessToken: "old",
      refreshToken: "oldref",
      expiresAt: Date.now() - 1,
      clientId: "cid-x",
      clientSecret: "secret-x",
    };
    const refreshed = await client.refreshAccessToken(auth);

    expect(mockFetch.mock.calls[0]![0]).toBe(`${RD_OAUTH_BASE}/token`);
    expect(refreshed.accessToken).toBe("new");
  });
});
