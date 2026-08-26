/**
 * M3U + XMLTV fallback IPTV client (docs/04-INTEGRATIONS.md §4).
 *
 * Only channel listing/normalization lives here — XMLTV/EPG parsing belongs
 * to the sibling `epg` module.
 */

import { fetchText, HttpError } from "../shared/http.js";
import type { Channel, ChannelCategory, IptvClient, M3uCredentials } from "../shared/types.js";
import { parseM3u } from "./m3u-parser.js";

const DEFAULT_CATEGORY = "Uncategorized";

function detectStreamFormat(url: string): Channel["streamFormat"] {
  const clean = (url.split("?")[0] ?? url).split("#")[0] ?? url;
  const lower = clean.toLowerCase();
  if (lower.endsWith(".m3u8")) return "hls";
  if (lower.endsWith(".ts")) return "ts";
  return "unknown";
}

/** Stable, deterministic synthetic id derived from the stream URL (M3U has no numeric ids). */
function syntheticChannelId(streamUrl: string, index: number): string {
  let hash = 0;
  for (let i = 0; i < streamUrl.length; i++) {
    hash = (hash * 31 + streamUrl.charCodeAt(i)) | 0;
  }
  return `m3u-${Math.abs(hash).toString(36)}-${index}`;
}

export class M3uClient implements IptvClient {
  readonly providerId: string;

  private readonly credentials: M3uCredentials;

  constructor(credentials: M3uCredentials) {
    this.credentials = credentials;
    this.providerId = credentials.id;
  }

  async validate(): Promise<boolean> {
    // HEAD is a cheap reachability probe before downloading a potentially huge
    // playlist, but a real server answering HEAD with 200 has no body to check
    // (that's normal, not a failure) — so any HEAD outcome other than a thrown
    // HttpError still needs a real GET to actually confirm the M3U signature.
    try {
      await fetchText(this.credentials.m3uUrl, { method: "HEAD" });
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
    }
    const text = await fetchText(this.credentials.m3uUrl, { method: "GET" });
    return text.trimStart().startsWith("#EXTM3U");
  }

  async getCategories(): Promise<ChannelCategory[]> {
    const entries = parseM3u(await fetchText(this.credentials.m3uUrl, { method: "GET" }));
    const hidden = new Set(this.credentials.hiddenCategories);
    const seen = new Set<string>();
    const categories: ChannelCategory[] = [];

    for (const entry of entries) {
      const name = entry.groupTitle || DEFAULT_CATEGORY;
      if (hidden.has(name) || seen.has(name)) continue;
      seen.add(name);
      categories.push({ id: name, name });
    }

    return categories;
  }

  async getChannels(): Promise<Channel[]> {
    const entries = parseM3u(await fetchText(this.credentials.m3uUrl, { method: "GET" }));
    const hidden = new Set(this.credentials.hiddenCategories);
    const channels: Channel[] = [];

    entries.forEach((entry, index) => {
      const category = entry.groupTitle || DEFAULT_CATEGORY;
      if (hidden.has(category)) return;

      channels.push({
        providerId: this.providerId,
        id: syntheticChannelId(entry.streamUrl, index),
        name: entry.tvgName || entry.displayName,
        logo: entry.tvgLogo,
        category,
        streamUrls: [entry.streamUrl],
        streamFormat: detectStreamFormat(entry.streamUrl),
        epgChannelId: entry.tvgId,
      });
    });

    return channels;
  }
}
