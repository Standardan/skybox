/**
 * PremiumizeClient — the DebridClient implementation for Premiumize
 * (https://www.premiumize.me/api). Implemented against Premiumize's published
 * API reference, not yet exercised against a real account — see
 * docs/08-OPEN-QUESTIONS.md OQ-18.
 *
 * Auth is a pasted long-lived API key from the user's Premiumize account page
 * (no device-code flow) — `connectWithApiKey` verifies it with one request.
 */
import { fetchJson, HttpError } from "../shared/http.js";
import type { DebridAuth, DebridAccountStatus, DebridClient, DebridResolveResult } from "../shared/types.js";

export const PREMIUMIZE_API_BASE = "https://www.premiumize.me/api";

interface PmAccountInfo {
  status: "success" | "error";
  message?: string;
  customer_id?: string;
  premium_until?: number; // epoch seconds, 0/absent if not premium
}

interface PmDirectDlContent {
  path: string;
  size: number;
  link: string;
  stream_link?: string;
}

interface PmDirectDlResponse {
  status: "success" | "error";
  message?: string;
  content?: PmDirectDlContent[];
}

function withKey(url: string, apikey: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}apikey=${encodeURIComponent(apikey)}`;
}

export class PremiumizeClient implements DebridClient {
  readonly provider = "premiumize";
  readonly authMethod = "apikey";

  async connectWithApiKey(apiKey: string): Promise<DebridAuth> {
    const auth: DebridAuth = { provider: "premiumize", accessToken: apiKey };
    // Verifies the key is real by requiring a successful account lookup —
    // an invalid key throws here rather than silently persisting.
    await this.getAccountStatus(auth);
    return auth;
  }

  async getAccountStatus(auth: DebridAuth): Promise<DebridAccountStatus> {
    const data = await fetchJson<PmAccountInfo>(withKey(`${PREMIUMIZE_API_BASE}/account/info`, auth.accessToken));
    if (data.status !== "success") {
      throw new HttpError(data.message ?? "Premiumize account lookup failed", 401, `${PREMIUMIZE_API_BASE}/account/info`);
    }
    const premiumUntilMs = data.premium_until ? data.premium_until * 1000 : null;
    const isPremium = premiumUntilMs !== null && premiumUntilMs > Date.now();
    return {
      username: data.customer_id ?? "premiumize",
      premiumUntil: isPremium ? premiumUntilMs : null,
      type: isPremium ? "premium" : "free",
    };
  }

  async resolveMagnet(auth: DebridAuth, infoHash: string, fileIdx?: number): Promise<DebridResolveResult> {
    const magnet = `magnet:?xt=urn:btih:${infoHash}`;
    return this.directDownload(auth, magnet, fileIdx);
  }

  async unrestrictLink(auth: DebridAuth, link: string): Promise<DebridResolveResult> {
    return this.directDownload(auth, link, 0);
  }

  private async directDownload(auth: DebridAuth, src: string, fileIdx?: number): Promise<DebridResolveResult> {
    const url = `${PREMIUMIZE_API_BASE}/transfer/directdl`;
    const body = new URLSearchParams({ apikey: auth.accessToken, src });
    const data = await fetchJson<PmDirectDlResponse>(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (data.status !== "success" || !data.content?.length) {
      throw new HttpError(
        data.message ?? "Premiumize could not resolve this source (likely not cached)",
        502,
        url,
      );
    }
    const index = fileIdx ?? 0;
    const file = data.content[index] ?? data.content[0]!;
    return {
      playableUrl: file.stream_link ?? file.link,
      filename: file.path.split("/").pop() ?? file.path,
      filesizeBytes: file.size,
    };
  }
}
