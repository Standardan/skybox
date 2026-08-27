/**
 * Removes a title from the library entirely (B7/B8-adjacent). Real feature
 * request: "dismiss" a Continue Watching item, or remove one from watch
 * history. Both are the same operation — markUnwatched already deletes any
 * non-watchlist item regardless of its actual state ("watching" or
 * "watched"), despite its name, so one route serves both call sites.
 */
import { NextResponse } from "next/server";
import { markUnwatched } from "@skybox/core/library";
import { updateLibrary } from "@/lib/library-store";
import { getCurrentUser } from "@/lib/session";

interface RemoveBody {
  metaId?: string;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });

  const body = (await request.json()) as RemoveBody;
  const { metaId } = body;

  if (!metaId) {
    return NextResponse.json({ ok: false, message: "Missing metaId." }, { status: 400 });
  }

  await updateLibrary(user.id, (items) => markUnwatched(items, metaId));

  return NextResponse.json({ ok: true });
}
