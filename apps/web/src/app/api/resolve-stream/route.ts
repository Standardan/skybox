import { NextResponse } from "next/server";
import { HttpError } from "@skybox/core/shared";
import { hasLikelyIncompatibleAudio, isLikelyUnplayableContainer } from "@skybox/core/addon-client";
import {
  isDebridConnected,
  resolveDebridSource,
  unrestrictDebridLink,
} from "@/lib/debrid-server";

/**
 * Status codes that genuinely mean "something's wrong with THIS release" —
 * 451 (pulled for legal reasons) and 404 (this specific hash/id isn't
 * known to the provider) — where a different source is actually worth
 * trying. Everything else defaults to NOT retryable: an HttpError means
 * the provider answered, but a status like 429 (rate limited) or 401/403
 * (auth/account trouble) applies to the whole account, not this one
 * source — trying the next source just fires another request at the same
 * throttled/broken account and gets the same answer, only faster and
 * worse. Real report this guards against: a burst of resolve attempts
 * across many sources tripped Real-Debrid's rate limiting, and blindly
 * treating 429 as "try the next source" meant the retry loop kept
 * hammering the same limited account across the whole source list instead
 * of backing off — actively making the rate limit worse, not working
 * around it.
 */
const CONTENT_SPECIFIC_STATUSES = new Set([404, 451]);

function isRetryableWithADifferentSource(error: unknown): boolean {
  return error instanceof HttpError && CONTENT_SPECIFIC_STATUSES.has(error.status);
}

/**
 * Debrid providers return 451 when a specific release has been pulled for a
 * legal/DMCA reason, and 429 when the account/IP is being rate limited —
 * both real, seen in production (Real-Debrid). Neither is a Skybox bug, so
 * both get a message that actually explains what happened instead of the
 * raw "Request failed: 429 ..."/"Request failed: 451 ...".
 */
function describeResolveError(error: unknown): string {
  if (error instanceof HttpError && error.status === 451) {
    return "This specific release was pulled by your debrid provider for legal reasons (a copyright takedown) — trying another source.";
  }
  if (error instanceof HttpError && error.status === 429) {
    return "Your debrid provider is rate-limiting this account right now (too many requests too quickly) — wait a bit before trying again. Trying more sources won't help; they all hit the same limit.";
  }
  if (!(error instanceof HttpError)) {
    return "Could not reach your debrid provider (connection reset or timed out). This is a network problem between your server and the provider, not this specific source — check your server's outbound network/DNS, or try again in a moment.";
  }
  return error instanceof Error ? error.message : "Failed to resolve this source.";
}

interface ResolveRequestBody {
  infoHash?: string;
  fileIdx?: number;
  url?: string;
  /** Release title/name — used only to decide whether this source's audio needs remuxing (see proxiedVideoUrl below). */
  title?: string;
  name?: string;
}

interface ResolveSuccess {
  ok: true;
  playableUrl: string;
  filename: string;
  /** True when this source is being routed through stream-proxy's ffmpeg remux — the client uses this to suppress the filename/title-based warning banners, which would otherwise describe a problem that's already been fixed server-side. */
  remuxed: boolean;
}

/**
 * Routes the real debrid-CDN URL through /api/stream-proxy instead of
 * handing it to the browser directly. Confirmed root cause of "resolving
 * works, but every file — mkv or mp4 — shows a black/frozen screen":
 * CORS on the debrid CDN is wide open (tested directly, any Origin gets
 * echoed back), so it isn't that; the presigned link is most likely bound
 * to the IP that requested it — this server's IP from the resolve step
 * above, not the end user's browser IP that actually tries to play it.
 * Fetching the real bytes from THIS server (same IP context that resolved
 * the link) instead of handing the raw CDN URL to the browser sidesteps
 * that regardless of the exact mechanism — same idea as the IPTV mixed-
 * content proxy, applied here for a different reason.
 *
 * `remux` tells the proxy to run this through ffmpeg (video stream-copied
 * untouched, audio re-encoded to AAC, output always MP4 regardless of
 * the input container) instead of a plain passthrough — decided here,
 * not client-side, since this is the one place with both the release's
 * title/name (for the audio-codec heuristic) AND the REAL resolved
 * filename (for a reliable container check, unlike the pre-resolve title
 * heuristic used for ranking elsewhere). Real feature request: "make
 * everything compatible" — full video transcoding (the HEVC side of the
 * same complaint) isn't realistic on this app's GPU-less VPS deployment,
 * but this audio-only remux happens to fix MKV/AVI/etc containers too as
 * a side effect of ffmpeg always outputting MP4, at no extra cost.
 */
function proxiedVideoUrl(rawUrl: string, remux: boolean): string {
  const params = new URLSearchParams({ url: rawUrl });
  if (remux) params.set("remuxAudio", "1");
  return `/api/stream-proxy?${params.toString()}`;
}

/**
 * For logging only — never the real URL verbatim. Debrid-resolved URLs
 * routinely carry an account token/API key as a query param (TorBox's
 * requestdl does exactly this), so logging it unredacted would leak a
 * live credential into server logs. Keeping the host/path/param *names*
 * is still enough to actually diagnose "what did we hand the browser"
 * (right shape of URL? right host? redirect param present or not?)
 * without exposing the secret itself.
 */
function redactedUrlForLogging(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const params = new URLSearchParams(url.search);
    for (const key of params.keys()) {
      if (/token|key|auth/i.test(key)) params.set(key, "[redacted]");
    }
    url.search = params.toString();
    return url.toString();
  } catch {
    return "[unparseable url]";
  }
}

interface ResolveFailure {
  ok: false;
  message: string;
  /** false when every other source would fail the exact same way — see isRetryableWithADifferentSource. */
  retryable: boolean;
}

/**
 * Resolves a chosen StremioStream (infoHash/fileIdx or a direct url) to a
 * playable URL via the user's connected debrid provider (B6). Never attempts
 * playback without a real resolved URL — an unresolved/failed source
 * surfaces a clear message instead (never a fabricated or silent stream).
 */
export async function POST(request: Request): Promise<NextResponse<ResolveSuccess | ResolveFailure>> {
  let body: ResolveRequestBody;
  try {
    body = (await request.json()) as ResolveRequestBody;
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request body.", retryable: false }, { status: 400 });
  }

  const { infoHash, fileIdx, url, title, name } = body;
  if (!infoHash && !url) {
    return NextResponse.json(
      { ok: false, message: "This source has no infoHash or url to resolve.", retryable: false },
      { status: 400 },
    );
  }
  // The title/name heuristic catches an incompatible audio codec, which a
  // filename alone can't tell us; the REAL resolved filename (checked per
  // return path below, once known) catches an unplayable container more
  // reliably than guessing from the title text ever could.
  const titleSuggestsIncompatibleAudio = hasLikelyIncompatibleAudio({ title, name });

  if (!(await isDebridConnected())) {
    // Not source-specific — every other source hits this exact same check.
    return NextResponse.json(
      { ok: false, message: "Connect a debrid provider in Settings to play this source.", retryable: false },
      { status: 409 },
    );
  }

  try {
    if (infoHash) {
      const result = await resolveDebridSource(infoHash, fileIdx);
      if (!result) {
        return NextResponse.json(
          { ok: false, message: "Your debrid provider could not resolve this source.", retryable: true },
          { status: 502 },
        );
      }
      console.log(
        `[resolve-stream] resolved "${result.filename}" -> ${redactedUrlForLogging(result.playableUrl)}`,
      );
      const remux = titleSuggestsIncompatibleAudio || isLikelyUnplayableContainer(result.filename);
      return NextResponse.json({
        ok: true,
        playableUrl: proxiedVideoUrl(result.playableUrl, remux),
        filename: result.filename,
        remuxed: remux,
      });
    }

    // url path: try unrestricting through the debrid provider first; some addons
    // already return direct, playable links, so a failed/unsupported
    // unrestrict falls back to using the addon's url as-is rather than
    // failing the whole request.
    let unrestricted: Awaited<ReturnType<typeof unrestrictDebridLink>> = null;
    try {
      unrestricted = await unrestrictDebridLink(url!);
    } catch {
      unrestricted = null;
    }

    if (unrestricted) {
      const remux = titleSuggestsIncompatibleAudio || isLikelyUnplayableContainer(unrestricted.filename);
      return NextResponse.json({
        ok: true,
        playableUrl: proxiedVideoUrl(unrestricted.playableUrl, remux),
        filename: unrestricted.filename,
        remuxed: remux,
      });
    }

    const fallbackFilename = url!.split("/").pop() || "stream";
    const remux = titleSuggestsIncompatibleAudio || isLikelyUnplayableContainer(fallbackFilename);
    return NextResponse.json({
      ok: true,
      playableUrl: proxiedVideoUrl(url!, remux),
      filename: fallbackFilename,
      remuxed: remux,
    });
  } catch (error) {
    console.error("[resolve-stream] failed:", error);
    return NextResponse.json(
      { ok: false, message: describeResolveError(error), retryable: isRetryableWithADifferentSource(error) },
      { status: 502 },
    );
  }
}
