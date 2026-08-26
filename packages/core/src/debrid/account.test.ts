import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAccountStatus } from "./account.js";
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

const auth: DebridAuth = {
  provider: "real-debrid",
  accessToken: "access-token-1",
  refreshToken: "refresh-token-1",
  expiresAt: Date.now() + 100_000,
};

describe("getAccountStatus", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("maps a premium account (premium seconds > 0)", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    const now = 1_750_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ id: 1, username: "danisawesome", premium: 86_400 }),
    );

    const status = await getAccountStatus(auth);

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${RD_REST_BASE}/user`);
    expect(init.headers.Authorization).toBe("Bearer access-token-1");

    expect(status).toEqual({
      username: "danisawesome",
      premiumUntil: now + 86_400 * 1000,
      type: "premium",
    });
    vi.useRealTimers();
  });

  it("maps a free account (premium seconds == 0) to premiumUntil: null", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 2, username: "freeuser", premium: 0 }));

    const status = await getAccountStatus(auth);

    expect(status).toEqual({
      username: "freeuser",
      premiumUntil: null,
      type: "free",
    });
  });
});
