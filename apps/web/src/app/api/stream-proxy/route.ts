/**
 * Same-origin passthrough for resolved debrid video (movies/shows) — same
 * idea as iptv-proxy.ts, but for a different confirmed root cause: real
 * report was "resolving works (server gets back a real playableUrl,
 * visible in logs), but the browser gets a black/frozen screen for
 * EVERY file, mkv or mp4 alike." Direct testing ruled out CORS (the
 * debrid CDN echoes back any Origin — wide open), which points at the
 * presigned download link being bound to the IP that requested it: our
 * server's IP from the resolve step, not the end user's browser IP that
 * actually tries to play it. Routing the real video bytes through this
 * server — the same IP context that resolved the link in the first
 * place — sidesteps that regardless of the exact mechanism.
 *
 * SSRF safety: unlike iptv-proxy.ts, there's no fixed list of "configured"
 * origins to check the target against — debrid CDN hostnames are dynamic
 * and provider-controlled, decided by TorBox/Real-Debrid/etc, not by this
 * app's own config. Instead, the target hostname's resolved IP is
 * rejected if it falls in a private/loopback/link-local range — the
 * standard mitigation for a "proxy an arbitrary external URL" endpoint —
 * on top of still requiring a signed-in session like the rest of the app.
 */
import "server-only";
import dns from "node:dns/promises";
import { getCurrentUser } from "@/lib/session";

const UPSTREAM_TIMEOUT_MS = 20_000;
const PASSTHROUGH_RESPONSE_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges"];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

/** RFC1918 + loopback + link-local + CGNAT + benchmarking + multicast/reserved. */
const PRIVATE_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
];

function isPrivateIPv4(ip: string): boolean {
  const target = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (target & mask) === (ipv4ToInt(base) & mask);
  });
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80") || lower.startsWith("::ffff:127.");
}

async function isSafeExternalHost(hostname: string): Promise<boolean> {
  try {
    const { address, family } = await dns.lookup(hostname);
    return family === 4 ? !isPrivateIPv4(address) : !isPrivateIPv6(address);
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Not signed in.", 401);

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
  if (!(await isSafeExternalHost(target.hostname))) {
    return jsonError("That host isn't reachable through this proxy.", 403);
  }

  const upstreamRequestHeaders: Record<string, string> = {};
  const range = request.headers.get("range");
  if (range) upstreamRequestHeaders.range = range;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), { headers: upstreamRequestHeaders, signal: controller.signal });
  } catch (error) {
    console.error(`[stream-proxy] fetch to ${target.hostname} failed`, error);
    return jsonError("Could not reach the debrid provider's CDN.", 502);
  } finally {
    clearTimeout(timer);
  }

  // Logged once per request (not per byte) — cheap, and this is exactly
  // the "did the proxy even get real video bytes back" signal that was
  // missing while diagnosing a real black-screen report: confirms
  // whether upstream is serving the expected content-type/range support
  // at all, without needing a client-side repro to find out.
  console.log(
    `[stream-proxy] ${target.hostname} -> ${upstream.status} ${upstream.headers.get("content-type") ?? "?"} range=${Boolean(range)}`,
  );

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
