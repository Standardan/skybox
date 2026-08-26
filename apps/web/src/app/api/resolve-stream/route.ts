import { NextResponse } from "next/server";
import { HttpError } from "@skybox/core/shared";
import {
  isDebridConnected,
  resolveDebridSource,
  unrestrictDebridLink,
} from "@/lib/debrid-server";

/**
 * Whether trying a *different* source is worth it, or whether this failure
 * will just repeat identically for every source since they all resolve
 * through the same debrid provider host. An HttpError means the provider
 * actually answered (with a real, if unhappy, response) — that can
 * genuinely be specific to this one release (451, "not cached", a dead
 * hash), so other sources are still worth trying. Anything else here is a
 * connection-level failure (DNS, refused/reset connection, timeout) that
 * never reached the provider at all — every other source hits the exact
 * same host and will fail the exact same way, so grinding through the rest
 * of a 20+ item source list is both pointless and, worse, exactly what
 * makes the UI feel "stuck" trying to resolve.
 */
function isRetryableWithADifferentSource(error: unknown): boolean {
  return error instanceof HttpError;
}

/**
 * Debrid providers return 451 when a specific release has been pulled for a
 * legal/DMCA reason — real, seen in production (Real-Debrid). It's not a
 * Skybox bug, so it gets a message that actually explains what happened
 * instead of the raw "Request failed: 451 ...".
 */
function describeResolveError(error: unknown): string {
  if (error instanceof HttpError && error.status === 451) {
    return "This specific release was pulled by your debrid provider for legal reasons (a copyright takedown) — trying another source.";
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
}

interface ResolveSuccess {
  ok: true;
  playableUrl: string;
  filename: string;
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

  const { infoHash, fileIdx, url } = body;
  if (!infoHash && !url) {
    return NextResponse.json(
      { ok: false, message: "This source has no infoHash or url to resolve.", retryable: false },
      { status: 400 },
    );
  }

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
      return NextResponse.json({ ok: true, playableUrl: result.playableUrl, filename: result.filename });
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
      return NextResponse.json({
        ok: true,
        playableUrl: unrestricted.playableUrl,
        filename: unrestricted.filename,
      });
    }

    return NextResponse.json({
      ok: true,
      playableUrl: url!,
      filename: url!.split("/").pop() || "stream",
    });
  } catch (error) {
    console.error("[resolve-stream] failed:", error);
    return NextResponse.json(
      { ok: false, message: describeResolveError(error), retryable: isRetryableWithADifferentSource(error) },
      { status: 502 },
    );
  }
}
