/**
 * Mixed-content mitigation for HTTP-only IPTV providers (ARCH-R3): a
 * browser blocks an HTTPS page's own `<video>`/hls.js from fetching an
 * `http://` stream directly. When that mismatch is detected, the client
 * gets a same-origin URL through `/api/iptv-proxy` instead of the raw
 * provider URL — otherwise (plain-http local/VPS access, or a provider
 * that's already HTTPS) the raw URL passes through unchanged, so nothing
 * routes through this server needlessly.
 */
import "server-only";
import { isRequestHttps } from "./session";

export { isRequestHttps };

export function needsStreamProxy(rawUrl: string, servedOverHttps: boolean): boolean {
  return servedOverHttps && rawUrl.startsWith("http://");
}

export function proxiedStreamUrl(rawUrl: string): string {
  return `/api/iptv-proxy?url=${encodeURIComponent(rawUrl)}`;
}

/** One-shot version for a single URL — call `isRequestHttps()` yourself and reuse `needsStreamProxy`/`proxiedStreamUrl` directly when resolving many URLs in one request (e.g. a whole channel list) to avoid re-checking headers per item. */
export async function resolvePlaybackStreamUrl(rawUrl: string): Promise<string> {
  const https = await isRequestHttps();
  return needsStreamProxy(rawUrl, https) ? proxiedStreamUrl(rawUrl) : rawUrl;
}
