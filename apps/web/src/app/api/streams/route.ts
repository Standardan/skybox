import { NextResponse, type NextRequest } from "next/server";
import { aggregateStreams } from "@skybox/core/addon-client";
import { getStreamAddons } from "@/lib/addon-server";

/**
 * Thin wrapper around the exact stream lookup title/[type]/[id]/page.tsx
 * already does inline for the CURRENTLY-viewed episode — parameterized by
 * `type`/`id` so PlaybackControls can also fetch the candidate list for
 * the NEXT episode in the background while the current one plays (see its
 * prefetchNextEpisodeStreams). No auth code needed here: every /api/*
 * path is already gated by middleware.ts, and stream results aren't
 * user-scoped (only Config.addons is, and that stays household-shared).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const type = request.nextUrl.searchParams.get("type");
  const id = request.nextUrl.searchParams.get("id");
  if (!type || !id) {
    return NextResponse.json({ streams: [] });
  }
  const addons = await getStreamAddons();
  const streams = addons.length > 0 ? await aggregateStreams(addons, type, id) : [];
  return NextResponse.json({ streams });
}
