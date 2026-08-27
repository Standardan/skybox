/**
 * My List (B9). Action-discriminator shape, same idea as
 * api/live-tv-prefs/route.ts's toggle-favorite — add/remove are the two
 * symmetric operations on one route rather than two near-identical files.
 */
import { NextResponse } from "next/server";
import { addToWatchlist, removeFromWatchlist } from "@skybox/core/library";
import type { MediaType } from "@skybox/core/shared";
import { updateLibrary } from "@/lib/library-store";
import { getCurrentUser } from "@/lib/session";

interface WatchlistBody {
  action?: "add" | "remove";
  metaId?: string;
  type?: MediaType;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });

  const body = (await request.json()) as WatchlistBody;
  const { action, metaId, type } = body;

  if (!metaId) {
    return NextResponse.json({ ok: false, message: "Missing metaId." }, { status: 400 });
  }

  if (action === "add") {
    if (!type) return NextResponse.json({ ok: false, message: "Missing type." }, { status: 400 });
    await updateLibrary(user.id, (items) => addToWatchlist(items, metaId, type));
    return NextResponse.json({ ok: true });
  }

  if (action === "remove") {
    await updateLibrary(user.id, (items) => removeFromWatchlist(items, metaId));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
}
