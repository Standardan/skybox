/**
 * Same-origin passthrough for HTTP-only IPTV streams (ARCH-R3) — see
 * stream-proxy.ts for when this gets used at all. `GET ?url=<upstream>`.
 *
 * SSRF safety: this instance may be reachable from the public internet
 * (the VPS "hub" deployment story), so the requested URL's origin must
 * match one of the user's own configured IPTV providers before anything is
 * fetched — otherwise this would be an open proxy anyone could point at an
 * arbitrary host (internal network, cloud metadata endpoints, etc.).
 *
 * HLS playlists get their segment/variant-playlist URIs rewritten to route
 * back through this same proxy (otherwise the browser would fetch the
 * *next* request directly against the http:// origin and hit the exact
 * mixed-content block this exists to avoid); everything else is streamed
 * through as-is, without buffering the whole body in memory.
 */
import "server-only";
import type { Config } from "@skybox/core/shared";
import { readConfig } from "@/lib/config-store";

const UPSTREAM_TIMEOUT_MS = 15_000;
const HLS_CONTENT_TYPES = ["mpegurl", "vnd.apple.mpegurl"];
const PASSTHROUGH_RESPONSE_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges"];

function originsMatch(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host;
}

function isConfiguredIptvOrigin(target: URL, config: Config): boolean {
  for (const provider of config.iptv) {
    const candidates = provider.type === "xtream" ? provider.baseUrls : [provider.m3uUrl, provider.epgUrl].filter(Boolean);
    for (const candidate of candidates) {
      try {
        if (originsMatch(new URL(candidate as string), target)) return true;
      } catch {
        // Malformed configured URL — not this instance's fault, just not a match.
      }
    }
  }
  return false;
}

function isHlsPlaylist(url: URL, contentType: string | null): boolean {
  if (contentType) {
    const lower = contentType.toLowerCase();
    if (HLS_CONTENT_TYPES.some((t) => lower.includes(t))) return true;
  }
  return url.pathname.toLowerCase().endsWith(".m3u8");
}

/**
 * Rewrites every URI line in an HLS playlist (segments and, for master
 * playlists, `#EXT-X-STREAM-INF` variant references) to route through this
 * proxy, resolving relative URIs against the playlist's own URL first.
 * Does not rewrite `#EXT-X-KEY` URIs (encrypted-stream key fetches) — not
 * seen on any real IPTV provider tested against; can be added if one turns
 * up that needs it.
 */
function rewriteHlsPlaylist(text: string, playlistUrl: URL): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      try {
        const absolute = new URL(trimmed, playlistUrl);
        return `/api/iptv-proxy?url=${encodeURIComponent(absolute.toString())}`;
      } catch {
        return line;
      }
    })
    .join("\n");
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const rawTarget = requestUrl.searchParams.get("url");
  if (!rawTarget) return jsonError("Missing url.", 400);

  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    return jsonError("Invalid url.", 400);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return jsonError("Unsupported protocol.", 400);
  }

  const config = await readConfig();
  if (!isConfiguredIptvOrigin(target, config)) {
    return jsonError("That origin isn't one of your configured IPTV providers.", 403);
  }

  const upstreamRequestHeaders: Record<string, string> = {};
  const range = request.headers.get("range");
  if (range) upstreamRequestHeaders.range = range;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), { headers: upstreamRequestHeaders, signal: controller.signal });
  } catch {
    return jsonError("Could not reach the IPTV provider.", 502);
  } finally {
    clearTimeout(timer);
  }

  const contentType = upstream.headers.get("content-type");

  if (isHlsPlaylist(target, contentType)) {
    const text = await upstream.text();
    return new Response(rewriteHlsPlaylist(text, target), {
      status: upstream.status,
      headers: { "Content-Type": contentType ?? "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
    });
  }

  const headers = new Headers();
  for (const key of PASSTHROUGH_RESPONSE_HEADERS) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set("Cache-Control", "no-store");

  return new Response(upstream.body, { status: upstream.status, headers });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
