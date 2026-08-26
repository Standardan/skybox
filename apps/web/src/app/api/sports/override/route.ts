/**
 * Sets a manual game -> channel override (D4). Manual override always wins
 * in `matchGameToChannels` (packages/core/src/sports/matcher.ts), so this
 * is the "not this channel?" escape hatch when the automatic network/EPG
 * match picked the wrong feed.
 *
 * Also "teaches the mapping" (the other half of D4/ARCH-R4): when `league`
 * and `teamNames` are provided, this channel is added to both teams'
 * learned history (`teamChannelHints`), so `matchByTeamHistory` picks it up
 * automatically for every future game either team plays — not just this
 * one event.
 */
import { NextResponse } from "next/server";
import { teamHintKey } from "@skybox/core/sports";
import { updateConfig } from "@/lib/config-store";

/** Keep each team's hint list small and recency-biased rather than growing forever. */
const MAX_HINTS_PER_TEAM = 5;

interface OverrideBody {
  gameId?: unknown;
  channelId?: unknown;
  league?: unknown;
  teamNames?: unknown;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as OverrideBody | null;
  const gameId = typeof body?.gameId === "string" ? body.gameId : null;
  const channelId = typeof body?.channelId === "string" ? body.channelId : null;
  const league = typeof body?.league === "string" ? body.league : null;
  const teamNames = Array.isArray(body?.teamNames) ? body.teamNames.filter((t): t is string => typeof t === "string") : [];

  if (!gameId || !channelId) {
    return NextResponse.json({ error: "gameId and channelId are required" }, { status: 400 });
  }

  await updateConfig((config) => {
    const teamChannelHints = { ...config.sports.teamChannelHints };
    if (league) {
      for (const teamName of teamNames) {
        const key = teamHintKey(league, teamName);
        const existing = teamChannelHints[key] ?? [];
        teamChannelHints[key] = [channelId, ...existing.filter((id) => id !== channelId)].slice(0, MAX_HINTS_PER_TEAM);
      }
    }

    return {
      ...config,
      sports: {
        ...config.sports,
        channelOverrides: { ...config.sports.channelOverrides, [gameId]: channelId },
        teamChannelHints,
      },
    };
  });

  return NextResponse.json({ ok: true });
}
