/**
 * Per-account Live TV customization (favorites + manual category/channel
 * order). Auth-gated by session, not admin-only — this is personal, like
 * watch history, not a household-level setting.
 */
import "server-only";
import { NextResponse } from "next/server";
import { reorder } from "@skybox/core/iptv";
import { getCurrentUser } from "@/lib/session";
import { readLiveTvPrefs, updateLiveTvPrefs, type LiveTvPrefs } from "@/lib/live-tv-prefs-store";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json(await readLiveTvPrefs(user.id));
}

interface PostBody {
  action?: unknown;
  channelKey?: unknown;
  categoryId?: unknown;
  movedId?: unknown;
  beforeId?: unknown;
  providerOrderIds?: unknown;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: PostBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.action === "toggle-favorite") {
    const channelKey = typeof body.channelKey === "string" ? body.channelKey : "";
    if (!channelKey) return NextResponse.json({ error: "Missing channelKey." }, { status: 400 });
    const prefs = await updateLiveTvPrefs(user.id, (p) => ({
      ...p,
      favoriteChannelKeys: p.favoriteChannelKeys.includes(channelKey)
        ? p.favoriteChannelKeys.filter((k) => k !== channelKey)
        : [...p.favoriteChannelKeys, channelKey],
    }));
    return NextResponse.json(prefs);
  }

  if (body.action === "reorder-favorites") {
    // Favorites are a plain user-ordered list (no "provider order" to merge
    // against, unlike categories/channels) — the new full order is given
    // directly.
    const favoriteChannelKeys = isStringArray(body.providerOrderIds) ? body.providerOrderIds : null;
    if (!favoriteChannelKeys) return NextResponse.json({ error: "Missing order." }, { status: 400 });
    const prefs = await updateLiveTvPrefs(user.id, (p) => ({ ...p, favoriteChannelKeys }));
    return NextResponse.json(prefs);
  }

  if (body.action === "reorder-categories") {
    const movedId = typeof body.movedId === "string" ? body.movedId : "";
    const beforeId = typeof body.beforeId === "string" ? body.beforeId : null;
    const providerOrderIds = isStringArray(body.providerOrderIds) ? body.providerOrderIds : null;
    if (!movedId || !providerOrderIds) {
      return NextResponse.json({ error: "Missing movedId or providerOrderIds." }, { status: 400 });
    }
    const prefs = await updateLiveTvPrefs(user.id, (p) => ({
      ...p,
      categoryOrder: reorder(p.categoryOrder, providerOrderIds, movedId, beforeId),
    }));
    return NextResponse.json(prefs);
  }

  if (body.action === "reorder-channels") {
    const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
    const movedId = typeof body.movedId === "string" ? body.movedId : "";
    const beforeId = typeof body.beforeId === "string" ? body.beforeId : null;
    const providerOrderIds = isStringArray(body.providerOrderIds) ? body.providerOrderIds : null;
    if (!categoryId || !movedId || !providerOrderIds) {
      return NextResponse.json({ error: "Missing categoryId, movedId, or providerOrderIds." }, { status: 400 });
    }
    const prefs = await updateLiveTvPrefs(user.id, (p): LiveTvPrefs => ({
      ...p,
      channelOrder: {
        ...p.channelOrder,
        [categoryId]: reorder(p.channelOrder[categoryId] ?? [], providerOrderIds, movedId, beforeId),
      },
    }));
    return NextResponse.json(prefs);
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
