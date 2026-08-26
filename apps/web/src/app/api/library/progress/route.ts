/**
 * Playback-progress reporting for Continue Watching (B7). Called by
 * PlaybackControls while a title/episode plays. Real persistence via
 * packages/core's own `upsertProgress` — see library-store.ts.
 */
import { NextResponse } from "next/server";
import { upsertProgress } from "@skybox/core/library";
import type { MediaType } from "@skybox/core/shared";
import { updateLibrary } from "@/lib/library-store";
import { getCurrentUser } from "@/lib/session";

interface ProgressBody {
  metaId?: string;
  type?: MediaType;
  videoId?: string;
  positionSec?: number;
  durationSec?: number;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });

  const body = (await request.json()) as ProgressBody;
  const { metaId, type, videoId, positionSec, durationSec } = body;

  if (!metaId || !type || !videoId || typeof positionSec !== "number" || typeof durationSec !== "number") {
    return NextResponse.json({ ok: false, message: "Missing or invalid progress fields." }, { status: 400 });
  }
  if (durationSec <= 0) {
    return NextResponse.json({ ok: false, message: "Duration must be positive." }, { status: 400 });
  }

  await updateLibrary(user.id, (items) =>
    upsertProgress(items, metaId, type, { videoId, positionSec, durationSec, updatedAt: Date.now() }),
  );

  return NextResponse.json({ ok: true });
}
