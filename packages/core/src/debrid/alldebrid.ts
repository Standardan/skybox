/**
 * AllDebridClient — the DebridClient implementation for AllDebrid (API v4,
 * https://docs.alldebrid.com). Implemented against AllDebrid's published API
 * reference, not yet exercised against a real account (no AllDebrid account
 * available to test with) — see docs/08-OPEN-QUESTIONS.md OQ-18.
 *
 * Auth is AllDebrid's "pin" flow: request a pin + check token, show the user
 * a short URL to visit, poll the check endpoint until they confirm — the same
 * shape as Real-Debrid's OAuth device-code flow, just AllDebrid's own scheme
 * (no OAuth token exchange step; the check response itself carries the apikey).
 */
import { fetchJson, HttpError } from "../shared/http.js";
import type {
  DebridAuth,
  DebridAccountStatus,
  DebridClient,
  DebridResolveResult,
  DebridDeviceAuthStart,
  DebridPollOptions,
} from "../shared/types.js";

export const ALLDEBRID_API_BASE = "https://api.alldebrid.com/v4";

/** Identifies this app to AllDebrid — required on every request, not a secret. */
const AGENT = "skybox";

interface AdEnvelope<T> {
  status: "success" | "error";
  data?: T;
  error?: { code: string; message: string };
}

interface AdPinGetData {
  pin: string;
  check: string;
  expires_in: number;
  base_url: string;
  check_url: string;
  user_url: string;
}

interface AdPinCheckData {
  activated: boolean;
  expires_in: number;
  apikey?: string;
}

interface AdUserData {
  user: {
    username: string;
    isPremium: boolean;
    premiumUntil?: number; // epoch seconds
  };
}

interface AdMagnetFile {
  n: string; // name
  s?: number; // size
  l?: string; // link
}

interface AdMagnetUploadEntry {
  id: number;
  hash: string;
  ready: boolean;
  files?: AdMagnetFile[];
}

interface AdMagnetUploadData {
  magnets: AdMagnetUploadEntry[];
}

interface AdMagnetStatusData {
  magnets: {
    id: number;
    status: string; // "Ready" once downloaded
    statusCode: number;
    links: AdMagnetFile[];
  };
}

interface AdLinkUnlockData {
  link: string;
  filename: string;
  filesize?: number;
}

async function adFetch<T>(url: string): Promise<T> {
  const envelope = await fetchJson<AdEnvelope<T>>(url);
  if (envelope.status === "error" || !envelope.data) {
    throw new HttpError(envelope.error?.message ?? "AllDebrid request failed", 502, url);
  }
  return envelope.data;
}

function withAuth(url: string, apikey: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}agent=${encodeURIComponent(AGENT)}&apikey=${encodeURIComponent(apikey)}`;
}

export class AllDebridClient implements DebridClient {
  readonly provider = "alldebrid";
  readonly authMethod = "device";

  async getAuthUrl(): Promise<DebridDeviceAuthStart> {
    const data = await adFetch<AdPinGetData>(`${ALLDEBRID_API_BASE}/pin/get?agent=${encodeURIComponent(AGENT)}`);
    return {
      verificationUrl: data.user_url,
      userCode: data.pin,
      // Both the pin and the opaque check token are needed to poll — encode
      // both into the single deviceCode string the caller persists/replays.
      deviceCode: `${data.pin}:${data.check}`,
      expiresIn: data.expires_in,
      interval: 5,
    };
  }

  async pollForToken(deviceCode: string, options: DebridPollOptions = {}): Promise<DebridAuth> {
    const [pin, check] = deviceCode.split(":");
    if (!pin || !check) {
      throw new Error("Invalid AllDebrid deviceCode — expected \"pin:check\".");
    }
    const {
      intervalMs = 5_000,
      maxAttempts = 60,
      sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    } = options;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const url = `${ALLDEBRID_API_BASE}/pin/check?agent=${encodeURIComponent(AGENT)}&check=${encodeURIComponent(check)}&pin=${encodeURIComponent(pin)}`;
      const data = await adFetch<AdPinCheckData>(url);
      if (data.activated && data.apikey) {
        return { provider: "alldebrid", accessToken: data.apikey };
      }
      if (attempt < maxAttempts - 1) {
        await sleep(intervalMs);
      }
    }
    throw new Error("Timed out waiting for AllDebrid pin confirmation");
  }

  async getAccountStatus(auth: DebridAuth): Promise<DebridAccountStatus> {
    const data = await adFetch<AdUserData>(withAuth(`${ALLDEBRID_API_BASE}/user`, auth.accessToken));
    return {
      username: data.user.username,
      premiumUntil: data.user.isPremium && data.user.premiumUntil ? data.user.premiumUntil * 1000 : null,
      type: data.user.isPremium ? "premium" : "free",
    };
  }

  async resolveMagnet(auth: DebridAuth, infoHash: string, fileIdx?: number): Promise<DebridResolveResult> {
    const magnet = `magnet:?xt=urn:btih:${infoHash}`;
    const uploadUrl = withAuth(
      `${ALLDEBRID_API_BASE}/magnet/upload?magnets[]=${encodeURIComponent(magnet)}`,
      auth.accessToken,
    );
    const uploaded = await adFetch<AdMagnetUploadData>(uploadUrl);
    const entry = uploaded.magnets[0];
    if (!entry) {
      throw new Error("AllDebrid did not accept this magnet");
    }

    let files = entry.files ?? [];
    if (!entry.ready) {
      files = await this.waitForMagnetReady(auth, entry.id);
    }
    const index = fileIdx ?? 0;
    const file = files[index];
    if (!file?.l) {
      throw new Error(`AllDebrid magnet ${entry.id} has no link at index ${index}`);
    }
    return this.unrestrictLink(auth, file.l);
  }

  private async waitForMagnetReady(auth: DebridAuth, magnetId: number): Promise<AdMagnetFile[]> {
    const intervalMs = 3_000;
    const maxAttempts = 60;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const url = withAuth(`${ALLDEBRID_API_BASE}/magnet/status?id=${magnetId}`, auth.accessToken);
      const data = await adFetch<AdMagnetStatusData>(url);
      if (data.magnets.status === "Ready") {
        return data.magnets.links;
      }
      if (data.magnets.statusCode >= 4) {
        throw new Error(`AllDebrid magnet ${magnetId} failed with status "${data.magnets.status}"`);
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
    throw new Error(`Timed out waiting for AllDebrid magnet ${magnetId} to finish downloading`);
  }

  async unrestrictLink(auth: DebridAuth, link: string): Promise<DebridResolveResult> {
    const url = withAuth(`${ALLDEBRID_API_BASE}/link/unlock?link=${encodeURIComponent(link)}`, auth.accessToken);
    const data = await adFetch<AdLinkUnlockData>(url);
    return { playableUrl: data.link, filename: data.filename, filesizeBytes: data.filesize };
  }
}
