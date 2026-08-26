import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  requestDeviceCode,
  checkDeviceAuthorization,
  exchangeDeviceCode,
  pollForToken,
  refreshAccessToken,
  isTokenExpired,
} from "./oauth.js";
import { RD_OAUTH_BASE, RD_OPEN_SOURCE_CLIENT_ID } from "./constants.js";
import type { DebridAuth } from "../shared/types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("requestDeviceCode", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to /oauth/v2/device/code with client_id + new_credentials=yes and maps the response", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        device_code: "devcode123",
        user_code: "ABCD1234",
        interval: 5,
        expires_in: 1800,
        verification_url: "https://real-debrid.com/device",
      }),
    );

    const result = await requestDeviceCode();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain(`${RD_OAUTH_BASE}/device/code`);
    expect(url).toContain(`client_id=${RD_OPEN_SOURCE_CLIENT_ID}`);
    expect(url).toContain("new_credentials=yes");
    expect(init).toMatchObject({ method: "POST" });

    expect(result).toEqual({
      verificationUrl: "https://real-debrid.com/device",
      userCode: "ABCD1234",
      deviceCode: "devcode123",
      expiresIn: 1800,
      interval: 5,
    });
  });
});

describe("checkDeviceAuthorization (single poll attempt)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns authorized:true with client credentials once the user confirms", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ client_id: "cid-123", client_secret: "csecret-456" }),
    );

    const result = await checkDeviceAuthorization("devcode123");

    expect(result).toEqual({ authorized: true, clientId: "cid-123", clientSecret: "csecret-456" });
    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toContain(`${RD_OAUTH_BASE}/device/credentials`);
    expect(url).toContain("code=devcode123");
  });

  it("returns authorized:false (not throw) while the user hasn't confirmed yet", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }, 400));

    const result = await checkDeviceAuthorization("devcode123");

    expect(result).toEqual({ authorized: false });
  });
});

describe("exchangeDeviceCode (single token exchange)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs form-encoded params to /oauth/v2/token and builds a DebridAuth", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        access_token: "access-abc",
        refresh_token: "refresh-xyz",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    );

    const auth = await exchangeDeviceCode("devcode123", "cid-123", "csecret-456");

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${RD_OAUTH_BASE}/token`);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("client_id")).toBe("cid-123");
    expect(body.get("client_secret")).toBe("csecret-456");
    expect(body.get("code")).toBe("devcode123");
    expect(body.get("grant_type")).toBe("http://oauth.net/grant_type/device/1.0");

    expect(auth).toEqual({
      provider: "real-debrid",
      accessToken: "access-abc",
      refreshToken: "refresh-xyz",
      expiresAt: now + 3600 * 1000,
      clientId: "cid-123",
      clientSecret: "csecret-456",
    });
    vi.useRealTimers();
  });
});

describe("pollForToken", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("polls until authorized without sleeping in real time, then exchanges the code", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    // First two polls: pending. Third: authorized. Fourth call: token exchange.
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }, 400))
      .mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }, 400))
      .mockResolvedValueOnce(jsonResponse({ client_id: "cid-1", client_secret: "sec-1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "tok",
          refresh_token: "reftok",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      );

    const sleep = vi.fn().mockResolvedValue(undefined);

    const auth = await pollForToken("devcode123", { sleep, intervalMs: 1 });

    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(2); // slept between the two pending polls only
    expect(auth.provider).toBe("real-debrid");
    expect(auth.accessToken).toBe("tok");
    expect(auth.refreshToken).toBe("reftok");
    expect(auth.clientId).toBe("cid-1");
    expect(auth.clientSecret).toBe("sec-1");
  });

  it("gives up after maxAttempts without ever calling the real timer", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(jsonResponse({ error: "authorization_pending" }, 400));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(pollForToken("devcode123", { sleep, intervalMs: 1, maxAttempts: 3 })).rejects.toThrow(
      /timed out/i,
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe("refreshAccessToken", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("exchanges the refresh token for a new access token via grant_type=refresh_token", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    const now = 1_800_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    );

    const existing: DebridAuth = {
      provider: "real-debrid",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: now - 1000, // already expired
      clientId: "cid-999",
      clientSecret: "secret-999",
    };

    const refreshed = await refreshAccessToken(existing);

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${RD_OAUTH_BASE}/token`);
    const body = new URLSearchParams(init.body as string);
    expect(body.get("client_id")).toBe("cid-999");
    expect(body.get("client_secret")).toBe("secret-999");
    expect(body.get("code")).toBe("old-refresh");
    expect(body.get("grant_type")).toBe("refresh_token");

    expect(refreshed).toEqual({
      provider: "real-debrid",
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: now + 3600 * 1000,
      clientId: "cid-999",
      clientSecret: "secret-999",
    });
    vi.useRealTimers();
  });

  it("throws if the auth has no persisted clientSecret", async () => {
    const auth: DebridAuth = {
      provider: "real-debrid",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: Date.now() - 1000,
      clientId: "cid-999",
    };
    await expect(refreshAccessToken(auth)).rejects.toThrow(/clientSecret/);
  });
});

describe("isTokenExpired", () => {
  it("detects an expired token", () => {
    const auth: DebridAuth = {
      provider: "real-debrid",
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() - 1,
    };
    expect(isTokenExpired(auth)).toBe(true);
  });

  it("treats a token within the default skew window as expired", () => {
    const auth: DebridAuth = {
      provider: "real-debrid",
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 10_000, // within default 30s skew
    };
    expect(isTokenExpired(auth)).toBe(true);
  });

  it("treats a comfortably-future token as valid", () => {
    const auth: DebridAuth = {
      provider: "real-debrid",
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    expect(isTokenExpired(auth)).toBe(false);
  });
});
