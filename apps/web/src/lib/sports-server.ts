/**
 * Server-only sports data access (D. Sports layer).
 *
 * Wires the real `packages/core/sports` pipeline (ESPN adapters ->
 * getTodaysGames -> matchGameToChannels) to real IPTV channels/EPG from
 * `iptv-server.ts` and real prefs from `config-store.ts`. Never fabricates
 * a game, score, or match — an adapter or matcher that finds nothing
 * simply contributes nothing.
 */
import "server-only";
import { EspnAdapter, getTodaysGames, matchGameToChannels } from "@skybox/core/sports";
import type { EpgProgramme, Game, SportsAdapter } from "@skybox/core/shared";
import { readConfig } from "./config-store";
import { getIptvSnapshot } from "./iptv-server";

/** Games run long; a window around "now" is enough for EPG title matching. */
const EPG_WINDOW_BEFORE_MS = 60 * 60 * 1000; // 1h
const EPG_WINDOW_AFTER_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Starter roster of ESPN-backed league adapters (D1). League ids match
 * what `config.sports.leagues` stores and what `SportsAdapter.league`
 * exposes — ESPN's own URL scheme is `{sport}/{league}` per
 * packages/core/src/sports/espn-adapter.ts.
 */
export function getFollowedLeagueAdapters(): SportsAdapter[] {
  return [
    new EspnAdapter("nfl", "football", "nfl"),
    new EspnAdapter("nba", "basketball", "nba"),
    new EspnAdapter("mlb", "baseball", "mlb"),
    new EspnAdapter("nhl", "hockey", "nhl"),
    new EspnAdapter("epl", "soccer", "eng.1"),
  ];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Case-insensitive substring match, either direction, against name or abbreviation. */
function teamIsFollowed(team: { name: string; abbreviation?: string }, followedTeams: string[]): boolean {
  const name = normalize(team.name);
  const abbr = team.abbreviation ? normalize(team.abbreviation) : null;
  return followedTeams.some((raw) => {
    const needle = normalize(raw);
    if (!needle) return false;
    if (name.includes(needle) || needle.includes(name)) return true;
    if (abbr && (abbr.includes(needle) || needle.includes(abbr))) return true;
    return false;
  });
}

/**
 * Today's games for the followed leagues (D3), each with `matchedChannels`
 * populated (D4) via the real network/EPG-title/manual-override pipeline,
 * filtered to followed teams when any are set (D2), sorted by start time.
 * Returns `[]` whenever sports is off or nothing is followed (D8) — a
 * normal, fully-supported state, not an error.
 */
export async function getTodaysMatchedGames(): Promise<Game[]> {
  const config = await readConfig();
  if (!config.sports.enabled) return [];

  const adapters = getFollowedLeagueAdapters();
  const games = await getTodaysGames(adapters, config.sports.leagues);
  if (games.length === 0) return [];

  const { channels, epgStore } = await getIptvSnapshot();

  const now = Date.now();
  const windowStart = now - EPG_WINDOW_BEFORE_MS;
  const windowEnd = now + EPG_WINDOW_AFTER_MS;
  const epgProgrammes: EpgProgramme[] = [];
  for (const channel of channels) {
    if (!channel.epgChannelId) continue;
    epgProgrammes.push(...epgStore.getProgrammesForChannel(channel.epgChannelId, windowStart, windowEnd));
  }

  for (const game of games) {
    game.matchedChannels = matchGameToChannels(
      game,
      channels,
      epgProgrammes,
      config.sports.channelOverrides,
      config.sports.teamChannelHints,
    );
  }

  const followedTeams = config.sports.teams;
  const filtered =
    followedTeams.length > 0
      ? games.filter((game) => teamIsFollowed(game.home, followedTeams) || teamIsFollowed(game.away, followedTeams))
      : games;

  return filtered.slice().sort((a, b) => a.startTime - b.startTime);
}
