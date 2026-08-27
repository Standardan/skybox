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

/**
 * Real production crash this guards against: killing the ffmpeg child
 * with SIGKILL while Readable.toWeb(child.stdout) is actively bridging
 * its output into a Response — which happens routinely here, since the
 * auto-retry loop aborts the in-flight request the instant it moves to
 * the next source — can make the underlying pipe closure and the
 * process's death race each other, and Node's stream-to-web bridge isn't
 * always robust against both an 'error' and a 'close'/'end' landing on
 * the same web-stream controller: the second one throws
 * `ERR_INVALID_STATE: Controller is already closed`, as an
 * uncaughtException Express-request-scoped try/catch can't reach (it
 * fires from inside Node's internal stream machinery, not synchronously
 * from any of our own code). Reproducing this exactly wasn't possible in
 * this sandbox — killChild below now explicitly destroys the stream
 * before killing the process (the Node-recommended way to abort a stream
 * being read, and the likely real fix), but this stays as a safety net
 * regardless: by the time this fires, the client has already disconnected
 * and nobody is waiting on the response, so swallowing just this one
 * specific, well-understood race is safe.
 *
 * Real report this SECOND case guards against: after shipping concurrent
 * source racing (PlaybackControls.tsx's racePool), the client now
 * routinely aborts an in-flight /api/resolve-stream request for whichever
 * candidate loses the race — happens on nearly every play, not as a rare
 * edge case. That client-side abort can surface server-side as an
 * uncaught `Error: aborted` with `code: "ECONNRESET"`, thrown from deep
 * inside Node's HTTP internals while a route handler is still mid-flight
 * (resolving via the debrid provider, or writing the response) — same
 * "outside any request-scoped try/catch's reach" story as the remux case
 * above, and same reasoning for why swallowing it is safe: by the time
 * this fires, the client has already disconnected and nobody is waiting
 * on that specific response.
 *
 * `process.on` is process-global, not scoped to this file's own route —
 * this listener protects every route in the app (confirmed: this exact
 * error was observed from /api/resolve-stream requests, not just this
 * file's own), simply because this module happens to be where it's
 * registered.
 *
 * Deliberately a no-op (not a rethrow) for anything that isn't one of
 * these two exact, identified cases: `process.on` supports multiple
 * listeners, and whatever Next.js's own uncaughtException handling
 * already does for every OTHER kind of crash keeps running exactly as
 * before — this listener only ever intercepts these two specific races,
 * never anything else.
 */
process.on("uncaughtException", (error) => {
  if (error instanceof Error && error.message.includes("Controller is already closed")) {
    console.warn("[stream-proxy] swallowed a benign closed-controller race from an aborted remux", error.message);
    return;
  }
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  if (code === "ECONNRESET" || (error instanceof Error && error.message === "aborted")) {
    console.warn("[stream-proxy] swallowed a benign aborted-connection error from a cancelled request", error);
  }
});

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
    // Real report: a release tagged with two languages (English AND
    // Russian audio both present) played in Russian despite an English
    // preference — the file's DEFAULT (first) audio track isn't
    // necessarily the preferred one; resolve-stream only asks for this
    // when the release looks multi-language AND a specific preference is
    // set (see hasMultipleLanguageTracksHint), so this is skipped
    // entirely for the common single-language case.
    const preferredAudioLang = requestUrl.searchParams.get("preferredAudioLang");
    const audioStreamIndex = preferredAudioLang
      ? await findPreferredAudioStreamIndex(target, preferredAudioLang)
      : null;
    const remuxed = await tryRemuxAudioStream(target, request.signal, audioStreamIndex);
    if (remuxed) return remuxed;
    // Real regression this guards against: sources that used to at least
    // play silently (audio-incompatible, pre-remux) were, for some
    // sources in production, timing out on the ffmpeg leg entirely and
    // ending up WORSE than before — a dead ~15s hang instead of silent
    // playback. Falling through to the exact same plain passthrough below
    // means a broken/slow/unreachable remux can never leave a source worse
    // off than it was before this feature existed — worst case, silent
    // audio again, never a hang.
    console.warn(`[stream-proxy] remux failed or timed out for ${target.hostname} — falling back to direct passthrough`);
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

/** This app's 2-letter LANGUAGE_OPTIONS codes -> ISO 639-2 (both the bibliographic and terminology variant where they differ — ffprobe/Matroska language tags can carry either). */
const LANGUAGE_ISO639_2: Record<string, string[]> = {
  en: ["eng"],
  es: ["spa"],
  fr: ["fre", "fra"],
  de: ["ger", "deu"],
  it: ["ita"],
  pt: ["por"],
  ru: ["rus"],
  hi: ["hin"],
  ja: ["jpn"],
  ko: ["kor"],
  zh: ["chi", "zho"],
};

const FFPROBE_TIMEOUT_MS = 10_000;

interface FfprobeAudioStream {
  codec_type?: string;
  tags?: { language?: string };
}

/**
 * Reads the REAL per-track language metadata from the file itself (not
 * the release title, which only tells you a language is present
 * SOMEWHERE, never which track order) and returns the audio-relative
 * index (0, 1, 2... among audio streams only, matching ffmpeg's own
 * `-map 0:a:N` convention — `-select_streams a` below already filters to
 * just audio, so array position IS that index) of the track tagged with
 * `preferredLanguage`. Null on anything short of a confident match —
 * unknown language code, ffprobe failure/timeout, no tags at all, or no
 * track actually tagged with it — so the caller falls back to its
 * previous "just take the first audio track" behavior rather than
 * guessing wrong.
 */
async function findPreferredAudioStreamIndex(target: URL, preferredLanguage: string): Promise<number | null> {
  const isoCodes = LANGUAGE_ISO639_2[preferredLanguage];
  if (!isoCodes) return null;

  const args = [
    "-timeout",
    String(FFPROBE_TIMEOUT_MS * 1000),
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_entries",
    "stream=codec_type:stream_tags=language",
    "-select_streams",
    "a",
    target.toString(),
  ];
  const child = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });

  let stdout = "";
  let stderrTail = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-FFMPEG_STDERR_TAIL_BYTES);
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
      resolve(null);
    }, FFPROBE_TIMEOUT_MS);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  if (exitCode !== 0) {
    if (exitCode !== null) {
      console.error(`[stream-proxy] ffprobe exited ${exitCode} probing ${target.hostname}`, stderrTail);
    }
    return null;
  }

  try {
    const parsed = JSON.parse(stdout) as { streams?: FfprobeAudioStream[] };
    const audioStreams = parsed.streams ?? [];
    const matchIndex = audioStreams.findIndex((s) => {
      const lang = s.tags?.language?.toLowerCase();
      return lang ? isoCodes.includes(lang) : false;
    });
    if (matchIndex === -1) {
      console.log(`[stream-proxy] no audio track tagged "${preferredLanguage}" for ${target.hostname}, taking the first one`);
      return null;
    }
    return matchIndex;
  } catch (error) {
    console.error(`[stream-proxy] could not parse ffprobe output for ${target.hostname}`, error);
    return null;
  }
}

const FFMPEG_STDERR_TAIL_BYTES = 4000;
// Bounds how long we'll wait for ffmpeg to actually produce output before
// giving up and falling back to a plain passthrough. Real regression this
// exists to prevent: without this, a slow/unreachable/stalled ffmpeg leg
// (network trouble reaching the debrid CDN, or anything else that makes
// ffmpeg hang rather than exit) meant the request just sat there forever —
// worse than the pre-remux behavior (silent but playing) it was supposed
// to improve on. ffmpeg's own `-timeout` flag (below) guards the network
// I/O specifically; this guards the whole startup regardless of cause.
const REMUX_STARTUP_TIMEOUT_MS = 15_000;

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
 *
 * Returns null (never throws, never hangs past REMUX_STARTUP_TIMEOUT_MS)
 * on any failure to actually start producing output — the caller falls
 * back to a plain passthrough in that case, so remux can only ever make
 * things better, never worse, than serving the file unmodified.
 *
 * `audioStreamIndex` (from findPreferredAudioStreamIndex, below) picks a
 * SPECIFIC audio track by its audio-relative index instead of always
 * taking the first one — null (no preference found/needed) keeps the
 * previous "just take whatever's first" behavior.
 */
async function tryRemuxAudioStream(
  target: URL,
  clientSignal: AbortSignal,
  audioStreamIndex: number | null,
): Promise<Response | null> {
  const args = [
    // ffmpeg's own protocol-level I/O timeout (microseconds) — guards
    // against a stalled read mid-stream, not just a slow start; the
    // startup race below is the other half, for a connection that never
    // gets anywhere at all.
    "-timeout",
    String(REMUX_STARTUP_TIMEOUT_MS * 1000),
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
    `0:a:${audioStreamIndex ?? 0}`,
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
  // Destroying the stream FIRST (not just killing the process) matters
  // once Readable.toWeb(child.stdout) is actively bridging this into a
  // Response, below — Node's own .destroy() drives a single, predictable
  // 'close' through the stream, whereas killing the process first lets
  // the pipe close abruptly on its own via the OS, which can race an
  // 'error' against an 'end'/'close' landing on the SAME web-stream
  // controller (see the uncaughtException listener above for what that
  // produces). Safe to call before the Response even exists too — a
  // Readable that's never been read from is still safe to destroy.
  function killChild() {
    if (!child.stdout.destroyed) child.stdout.destroy();
    if (!child.killed) child.kill("SIGKILL");
  }
  clientSignal.addEventListener("abort", killChild, { once: true });
  child.once("exit", () => clientSignal.removeEventListener("abort", killChild));

  // Waits for ffmpeg to have real output buffered (the 'readable' event —
  // unlike 'data', this doesn't itself consume anything, so Readable.toWeb
  // below still sees the stream from the very start) before committing to
  // this Response at all. A missing/broken binary, a network stall
  // reaching the debrid CDN, or anything else that keeps ffmpeg from ever
  // producing output all land here the same way: no output within the
  // timeout, kill it, return null, let the caller fall back.
  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), REMUX_STARTUP_TIMEOUT_MS);
    child.stdout.once("readable", () => {
      clearTimeout(timer);
      resolve(true);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      console.error(`[stream-proxy] failed to start ffmpeg for ${target.hostname}`, error);
      resolve(false);
    });
    // Fires on ANY exit, any code — including 0 with zero bytes ever
    // written (e.g. a genuinely empty/zero-duration input). If 'readable'
    // above already fired first, the promise has already settled and this
    // resolve() is a harmless no-op (a promise settles only once).
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });

  if (!ready) {
    killChild();
    return null;
  }

  const headers = new Headers({ "Content-Type": "video/mp4", "Cache-Control": "no-store" });
  return new Response(Readable.toWeb(child.stdout) as unknown as ReadableStream, { status: 200, headers });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
