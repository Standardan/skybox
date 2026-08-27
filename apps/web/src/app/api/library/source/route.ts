/**
 * Records the specific source that just successfully played, so a later
 * visit to the same title tries that exact one first instead of starting
 * the whole ranking/auto-retry over from scratch — real feature request:
 * "if the movie is working for me right now... tomorrow I want to watch
 * the same movie, it should first test the one I was watching
 * successfully." Called by PlaybackControls once Player.tsx confirms
 * stable playback (see Player.tsx's onConfirmedWorking), not on every
 * resolve — a source that merely resolved but then failed to actually
 * play shouldn't get remembered as "working".
 */
import { NextResponse } from "next/server";
import { setLastWorkingSource } from "@skybox/core/library";
import type { MediaType } from "@skybox/core/shared";
import { updateLibrary } from "@/lib/library-store";
import { getCurrentUser } from "@/lib/session";

interface SourceBody {
  metaId?: string;
  type?: MediaType;
  videoId?: string;
  infoHash?: string;
  fileIdx?: number;
  url?: string;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });

  const body = (await request.json()) as SourceBody;
  const { metaId, type, videoId, infoHash, fileIdx, url } = body;

  if (!metaId || !type || !videoId) {
    return NextResponse.json({ ok: false, message: "Missing metaId, type, or videoId." }, { status: 400 });
  }
  if (!infoHash && !url) {
    return NextResponse.json({ ok: false, message: "Source has neither infoHash nor url." }, { status: 400 });
  }

  await updateLibrary(user.id, (items) =>
    setLastWorkingSource(items, metaId, type, { videoId, infoHash, fileIdx, url }),
  );

  return NextResponse.json({ ok: true });
}
