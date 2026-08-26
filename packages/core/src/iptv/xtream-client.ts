/**
 * Xtream Codes API client (docs/04-INTEGRATIONS.md §3), resilient across
 * multiple candidate mirrors of the same account.
 *
 * Base call pattern: `{baseUrl}/player_api.php?username=U&password=P&action=A`.
 * Live stream URLs: `{baseUrl}/live/{username}/{password}/{streamId}.{ext}`.
 *
 * Mirror failover strategy: try the last mirror that worked, on its own,
 * first (the common case — cheap, no point hammering every mirror when the
 * usual one is fine). If that fails, race every remaining candidate
 * concurrently (bounded per-candidate timeout) and take the first success,
 * rather than walking the list sequentially — with a dozen dead DNS entries,
 * sequential probing could take minutes; racing keeps worst-case latency to
 * one timeout window. Whichever mirror answers becomes the new last-known-good.
 */

import { fetchJson, type FetchJsonOptions } from "../shared/http.js";
import type { Channel, ChannelCategory, IptvClient, XtreamCredentials } from "../shared/types.js";

const MIRROR_TIMEOUT_MS = 6_000;

interface XtreamAuthResponse {
  user_info?: {
    auth?: number | boolean;
    [key: string]: unknown;
  };
  server_info?: Record<string, unknown>;
}

interface XtreamCategoryEntry {
  // Real providers are inconsistent about whether this is a JSON string or
  // number — sometimes even differently between get_live_categories and
  // get_live_streams on the *same* provider. Every read of this field gets
  // coerced with String() below rather than trusted at the declared type,
  // since a stray number vs. "number" mismatch here silently broke
  // "hide this category" (a Set of coerced strings never matched an
  // uncoerced number, so nothing was ever recognized as hidden).
  category_id: string | number;
  category_name: string;
}

interface XtreamStreamEntry {
  stream_id: number | string;
  name: string;
  stream_icon?: string | null;
  category_id?: string | number | null;
  epg_channel_id?: string | null;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function buildActionUrl(baseUrl: string, username: string, password: string, action?: string): string {
  const base = stripTrailingSlash(baseUrl);
  const params = new URLSearchParams({ username, password });
  if (action) {
    params.set("action", action);
  }
  return `${base}/player_api.php?${params.toString()}`;
}

/**
 * Builds a live stream URL for a given stream id against a specific
 * (already-resolved) mirror. Defaults to the HLS (.m3u8) variant; pass
 * `format: "ts"` for the raw MPEG-TS variant (needs mpegts.js in-browser
 * per docs/04-INTEGRATIONS.md §3).
 */
export function buildXtreamStreamUrl(
  baseUrl: string,
  username: string,
  password: string,
  streamId: number | string,
  format: "hls" | "ts" = "hls",
): string {
  const base = stripTrailingSlash(baseUrl);
  const ext = format === "hls" ? "m3u8" : "ts";
  return `${base}/live/${username}/${password}/${streamId}.${ext}`;
}

export class MirrorFailoverError extends Error {
  constructor(
    label: string,
    public readonly baseUrls: string[],
    public readonly causes: unknown[],
  ) {
    super(`All ${baseUrls.length} mirror(s) failed for provider "${label}": ${baseUrls.join(", ")}`);
    this.name = "MirrorFailoverError";
  }
}

export class XtreamClient implements IptvClient {
  readonly providerId: string;

  private readonly credentials: XtreamCredentials;

  /** The mirror that answered the last successful call, tried first next time. */
  private lastWorkingBaseUrl: string | null = null;

  constructor(credentials: XtreamCredentials) {
    if (credentials.baseUrls.length === 0) {
      throw new Error(`XtreamCredentials "${credentials.label}" has no baseUrls configured.`);
    }
    this.credentials = credentials;
    this.providerId = credentials.id;
  }

  /** Which mirror is currently believed healthy, if any have been tried yet. */
  getActiveBaseUrl(): string | null {
    return this.lastWorkingBaseUrl;
  }

  private async withFailover<T>(attempt: (baseUrl: string) => Promise<T>): Promise<T> {
    const { baseUrls, label } = this.credentials;
    const preferred = this.lastWorkingBaseUrl && baseUrls.includes(this.lastWorkingBaseUrl) ? this.lastWorkingBaseUrl : null;
    const causes: unknown[] = [];

    if (preferred) {
      try {
        const value = await attempt(preferred);
        this.lastWorkingBaseUrl = preferred;
        return value;
      } catch (err) {
        causes.push(err);
      }
    }

    const remaining = baseUrls.filter((url) => url !== preferred);
    if (remaining.length === 0) {
      throw new MirrorFailoverError(label, baseUrls, causes);
    }

    // Promise.any, not allSettled: allSettled only ever resolves once EVERY
    // candidate has either succeeded or hit its own MIRROR_TIMEOUT_MS — so
    // with a dozen dead mirrors and one healthy one, a request that could
    // have come back in 50ms instead sat blocked for the full timeout
    // window regardless, since nothing short-circuited on the first
    // success. Promise.any resolves the instant any candidate succeeds
    // (only rejecting, with every cause bundled into an AggregateError, if
    // they all fail) — this is the actual "take the first success" the
    // comment above always described.
    try {
      const winner = await Promise.any(remaining.map(async (baseUrl) => ({ baseUrl, value: await attempt(baseUrl) })));
      this.lastWorkingBaseUrl = winner.baseUrl;
      return winner.value;
    } catch (err) {
      if (err instanceof AggregateError) causes.push(...err.errors);
      else causes.push(err);
      throw new MirrorFailoverError(label, baseUrls, causes);
    }
  }

  private fetchOptions(): FetchJsonOptions {
    return { timeoutMs: MIRROR_TIMEOUT_MS };
  }

  async validate(): Promise<boolean> {
    // A definitive "wrong credentials" response (auth: 0) means this mirror
    // IS reachable and DID answer — since every mirror shares one account,
    // that's authoritative, not a reason to try the rest of the list. Only
    // network-level failures (timeout, DNS failure, non-JSON) fall through
    // to the next candidate.
    return this.withFailover(async (baseUrl) => {
      const url = buildActionUrl(baseUrl, this.credentials.username, this.credentials.password);
      const data = await fetchJson<XtreamAuthResponse>(url, this.fetchOptions());
      return data?.user_info?.auth === 1;
    });
  }

  async getCategories(): Promise<ChannelCategory[]> {
    const hidden = new Set(this.credentials.hiddenCategories);
    return this.withFailover(async (baseUrl) => {
      const url = buildActionUrl(baseUrl, this.credentials.username, this.credentials.password, "get_live_categories");
      const data = await fetchJson<XtreamCategoryEntry[]>(url, this.fetchOptions());
      return data
        .filter((entry) => !hidden.has(String(entry.category_id)))
        .map((entry) => ({ id: String(entry.category_id), name: entry.category_name }));
    });
  }

  async getChannels(): Promise<Channel[]> {
    const hidden = new Set(this.credentials.hiddenCategories);
    // The mirror that answers get_live_streams reliably isn't necessarily
    // reliable for actually serving the streams themselves (a real,
    // observed provider failure mode) — so every channel carries a
    // streamUrls candidate list across ALL configured mirrors, not just
    // this one, with the one that just answered listed first since it's
    // the most-likely-good guess.
    const { baseUrls, username, password } = this.credentials;
    return this.withFailover(async (baseUrl) => {
      const url = buildActionUrl(baseUrl, username, password, "get_live_streams");
      const data = await fetchJson<XtreamStreamEntry[]>(url, this.fetchOptions());
      const mirrorsForStreaming = [baseUrl, ...baseUrls.filter((u) => u !== baseUrl)];
      return data
        .filter((entry) => {
          const categoryId = entry.category_id ?? undefined;
          return categoryId === undefined || !hidden.has(String(categoryId));
        })
        .map((entry) => ({
          providerId: this.providerId,
          id: String(entry.stream_id),
          name: entry.name,
          logo: entry.stream_icon || undefined,
          category: entry.category_id ? String(entry.category_id) : "",
          streamUrls: mirrorsForStreaming.map((mirror) =>
            buildXtreamStreamUrl(mirror, username, password, entry.stream_id, "hls"),
          ),
          streamFormat: "hls" as const,
          epgChannelId: entry.epg_channel_id || undefined,
        }));
    });
  }
}
