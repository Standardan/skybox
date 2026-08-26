import { NextResponse } from "next/server";
import {
  isDebridConnected,
  resolveDebridSource,
  unrestrictDebridLink,
} from "@/lib/debrid-server";

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
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  const { infoHash, fileIdx, url } = body;
  if (!infoHash && !url) {
    return NextResponse.json(
      { ok: false, message: "This source has no infoHash or url to resolve." },
      { status: 400 },
    );
  }

  if (!(await isDebridConnected())) {
    return NextResponse.json(
      { ok: false, message: "Connect a debrid provider in Settings to play this source." },
      { status: 409 },
    );
  }

  try {
    if (infoHash) {
      const result = await resolveDebridSource(infoHash, fileIdx);
      if (!result) {
        return NextResponse.json(
          { ok: false, message: "Your debrid provider could not resolve this source." },
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
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Failed to resolve this source." },
      { status: 502 },
    );
  }
}
