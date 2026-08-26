/**
 * TorboxClient — the DebridClient implementation for TorBox
 * (https://api.torbox.app/v1/api docs). Implemented against TorBox's
 * published API reference, not yet exercised against a real account — see
 * docs/08-OPEN-QUESTIONS.md OQ-18.
 *
 * Auth is a pasted long-lived API key from the user's TorBox account page
 * (no device-code flow) — `connectWithApiKey` verifies it with one request.
 */
import { fetchJson, HttpError } from "../shared/http.js";
import type { DebridAuth, DebridAccountStatus, DebridClient, DebridResolveResult } from "../shared/types.js";

export const TORBOX_API_BASE = "https://api.torbox.app/v1/api";

interface TbEnvelope<T> {
  success: boolean;
  detail?: string;
  data?: T;
}

interface TbUserData {
  id: number;
  email: string;
  plan: number; // 0 = free, >0 = paid tier
  premium_expires_at?: string; // ISO date
}

interface TbCreateTorrentData {
  torrent_id: number;
  hash: string;
}

interface TbTorrentFile {
  id: number;
  name: string;
  size: number;
}

interface TbTorrentInfo {
  id: number;
  hash: string;
  download_finished: boolean;
  download_present: boolean;
  files: TbTorrentFile[];
}

function authHeaders(auth: DebridAuth): Record<string, string> {
  return { Authorization: `Bearer ${auth.accessToken}` };
}

async function tbFetch<T>(url: string, auth: DebridAuth, init: RequestInit = {}): Promise<T> {
  const envelope = await fetchJson<TbEnvelope<T>>(url, {
    ...init,
    headers: { ...authHeaders(auth), ...init.headers },
  });
  if (!envelope.success || envelope.data === undefined) {
    throw new HttpError(envelope.detail ?? "TorBox request failed", 502, url);
  }
  return envelope.data;
}

export class TorboxClient implements DebridClient {
  readonly provider = "torbox";
  readonly authMethod = "apikey";

  async connectWithApiKey(apiKey: string): Promise<DebridAuth> {
    const auth: DebridAuth = { provider: "torbox", accessToken: apiKey };
    await this.getAccountStatus(auth);
    return auth;
  }

  async getAccountStatus(auth: DebridAuth): Promise<DebridAccountStatus> {
    const data = await tbFetch<TbUserData>(`${TORBOX_API_BASE}/user/me`, auth);
    const premiumUntil = data.plan > 0 && data.premium_expires_at ? Date.parse(data.premium_expires_at) : null;
    return {
      username: data.email,
      premiumUntil,
      type: data.plan > 0 ? "premium" : "free",
    };
  }

  async resolveMagnet(auth: DebridAuth, infoHash: string, fileIdx?: number): Promise<DebridResolveResult> {
    const magnet = `magnet:?xt=urn:btih:${infoHash}`;
    const body = new URLSearchParams({ magnet, seed: "1", allow_zip: "false" });
    const created = await tbFetch<TbCreateTorrentData>(`${TORBOX_API_BASE}/torrents/createtorrent`, auth, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const info = await this.waitForDownload(auth, created.torrent_id);
    const index = fileIdx ?? 0;
    const file = info.files[index] ?? info.files[0];
    if (!file) {
      throw new Error(`TorBox torrent ${created.torrent_id} has no files`);
    }

    const dlUrl = `${TORBOX_API_BASE}/torrents/requestdl?token=${encodeURIComponent(auth.accessToken)}&torrent_id=${created.torrent_id}&file_id=${file.id}`;
    const link = await tbFetch<string>(dlUrl, auth);
    return { playableUrl: link, filename: file.name, filesizeBytes: file.size };
  }

  async unrestrictLink(): Promise<DebridResolveResult> {
    // TorBox is torrent/usenet-focused with no generic hoster-link unrestrict
    // endpoint like Real-Debrid's — addon streams that hand back a raw
    // magnet/infoHash go through resolveMagnet instead.
    throw new Error("TorBox does not support resolving direct hoster links, only magnets/torrents.");
  }

  private async waitForDownload(auth: DebridAuth, torrentId: number): Promise<TbTorrentInfo> {
    const intervalMs = 3_000;
    const maxAttempts = 60;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const info = await tbFetch<TbTorrentInfo>(`${TORBOX_API_BASE}/torrents/mylist?id=${torrentId}`, auth);
      if (info.download_finished || info.download_present) {
        return info;
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
    throw new Error(`Timed out waiting for TorBox torrent ${torrentId} to finish downloading`);
  }
}
