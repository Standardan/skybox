/**
 * Magnet resolution: addMagnet -> selectFiles -> poll torrents/info until
 * downloaded -> unrestrict the resulting link into a direct playable URL.
 */

import { fetchJson } from "../shared/http.js";
import type { DebridAuth, DebridResolveResult } from "../shared/types.js";
import { RD_REST_BASE } from "./constants.js";
import { postFormJson, postFormVoid } from "./http.js";
import type { RdAddMagnetResponse, RdTorrentInfo, RdUnrestrictLinkResponse, PollOptions } from "./types.js";

function authHeaders(auth: DebridAuth): Record<string, string> {
  return { Authorization: `Bearer ${auth.accessToken}` };
}

const FAILURE_STATUSES = new Set(["magnet_error", "error", "virus", "dead"]);

/** Step 1: register a magnet/infoHash with Real-Debrid. */
export async function addMagnet(auth: DebridAuth, infoHash: string): Promise<{ id: string; uri: string }> {
  const magnet = `magnet:?xt=urn:btih:${infoHash}`;
  const data = await postFormJson<RdAddMagnetResponse>(
    `${RD_REST_BASE}/torrents/addMagnet`,
    { magnet },
    { headers: authHeaders(auth) },
  );
  return { id: data.id, uri: data.uri };
}

/** Step 2: select which file(s) in the torrent to fetch (defaults to "all"). */
export async function selectFiles(auth: DebridAuth, torrentId: string, fileIdx?: number): Promise<void> {
  const files = fileIdx === undefined ? "all" : String(fileIdx);
  await postFormVoid(
    `${RD_REST_BASE}/torrents/selectFiles/${torrentId}`,
    { files },
    { headers: authHeaders(auth) },
  );
}

/**
 * Step 3, single attempt: fetch current torrent status/links. The directly
 * testable unit — `waitForTorrentDownload` is the bounded loop around it.
 */
export async function getTorrentInfo(auth: DebridAuth, torrentId: string): Promise<RdTorrentInfo> {
  return fetchJson<RdTorrentInfo>(`${RD_REST_BASE}/torrents/info/${torrentId}`, {
    headers: authHeaders(auth),
  });
}

/** Polls `getTorrentInfo` until status is "downloaded", bounded by maxAttempts. */
export async function waitForTorrentDownload(
  auth: DebridAuth,
  torrentId: string,
  options: PollOptions = {},
): Promise<RdTorrentInfo> {
  const {
    intervalMs = 3_000,
    maxAttempts = 60,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const info = await getTorrentInfo(auth, torrentId);
    if (info.status === "downloaded") {
      return info;
    }
    if (FAILURE_STATUSES.has(info.status)) {
      throw new Error(`Real-Debrid torrent ${torrentId} failed with status "${info.status}"`);
    }
    if (attempt < maxAttempts - 1) {
      await sleep(intervalMs);
    }
  }
  throw new Error(`Timed out waiting for Real-Debrid torrent ${torrentId} to finish downloading`);
}

/** Step 4: turn a Real-Debrid hoster link into a direct, playable HTTPS URL. */
export async function unrestrictLink(auth: DebridAuth, link: string): Promise<DebridResolveResult> {
  const data = await postFormJson<RdUnrestrictLinkResponse>(
    `${RD_REST_BASE}/unrestrict/link`,
    { link },
    { headers: authHeaders(auth) },
  );
  return {
    playableUrl: data.download,
    filename: data.filename,
    filesizeBytes: data.filesize,
  };
}

/** Full magnet/infoHash -> playable URL flow. */
export async function resolveMagnet(
  auth: DebridAuth,
  infoHash: string,
  fileIdx?: number,
  pollOptions?: PollOptions,
): Promise<DebridResolveResult> {
  const { id } = await addMagnet(auth, infoHash);
  await selectFiles(auth, id, fileIdx);
  const info = await waitForTorrentDownload(auth, id, pollOptions);
  const index = fileIdx ?? 0;
  const link = info.links?.[index];
  if (!link) {
    throw new Error(`Real-Debrid torrent ${id} has no link at index ${index}`);
  }
  return unrestrictLink(auth, link);
}
