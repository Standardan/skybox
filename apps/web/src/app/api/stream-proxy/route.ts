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
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
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

  if (requestUrl.searchParams.get("remuxAudio") === "1") {
    return remuxAudioStream(target, request.signal);
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

const FFMPEG_STDERR_TAIL_BYTES = 4000;

/**
 * Real-time audio-only remux: video is stream-copied untouched (`-c:v
 * copy`, no re-encode — cheap, near-zero CPU), audio is re-encoded to AAC
 * (`-c:a aac`) since that's the one codec family every browser decodes
 * natively. Fixes releases whose audio is DTS/AC3/E-AC3/TrueHD/Atmos —
 * genuinely unplayable in any browser, not a Skybox bug, but no longer a
 * dead end either.
 *
 * Deliberately NOT full video transcoding: real-time software 4K HEVC
 * re-encoding needs GPU acceleration to keep up (Jellyfin's own hardware
 * guidance all but requires it), which this app's typical VPS deployment
 * doesn't have — attempting it would mean stuttering/buffering, likely a
 * worse experience than not offering the source at all. Audio-only remux
 * needs no such thing: decoding+encoding audio is a tiny fraction of the
 * work video would be, so it's comfortably real-time on ordinary CPU.
 *
 * Known limitation, accepted for this first version: NO seeking support.
 * ffmpeg writes a fragmented MP4 to a pipe (`frag_keyframe+empty_moov+
 * default_base_moof` — the standard flags for streaming MP4 without
 * being able to seek back and rewrite the moov atom at the end, which
 * isn't possible on a pipe), with no known total length up front, so
 * there's no byte-offset-to-time mapping for the browser to compute a
 * meaningful Range request from — the incoming Range header is ignored
 * entirely here. Playback works start to finish; scrubbing doesn't.
 * Properly fixing that means HLS segmenting with a real playlist, a
 * meaningfully bigger feature than this pass — noted, not attempted.
 */
function remuxAudioStream(target: URL, clientSignal: AbortSignal): Response {
  const args = [
    "-loglevel",
    "error",
    "-nostats",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "5",
    "-i",
    target.toString(),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-f",
    "mp4",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "pipe:1",
  ];
  const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

  let stderrTail = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-FFMPEG_STDERR_TAIL_BYTES);
  });
  child.on("close", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[stream-proxy] ffmpeg exited ${code} remuxing ${target.hostname}`, stderrTail);
    }
  });
  // Can't change the HTTP status by the time this fires (the Response
  // below has already gone out with the process's stdout as its body) —
  // logged so a missing/broken ffmpeg binary is at least diagnosable
  // server-side instead of just an empty response with no explanation.
  child.on("error", (error) => {
    console.error(`[stream-proxy] failed to start ffmpeg for ${target.hostname}`, error);
  });
  function killChild() {
    if (!child.killed) child.kill("SIGKILL");
  }
  clientSignal.addEventListener("abort", killChild, { once: true });
  child.once("exit", () => clientSignal.removeEventListener("abort", killChild));

  const headers = new Headers({ "Content-Type": "video/mp4", "Cache-Control": "no-store" });
  return new Response(Readable.toWeb(child.stdout) as unknown as ReadableStream, { status: 200, headers });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
