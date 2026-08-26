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
import { EspnAdapter, fetchLeagueTeams, getTodaysGames, matchGameToChannels } from "@skybox/core/sports";
import type { EpgProgramme, Game, SportsAdapter } from "@skybox/core/shared";
import { readConfig } from "./config-store";
import { getIptvSnapshot } from "./iptv-server";

/** Games run long; a window around "now" is enough for EPG title matching. */
const EPG_WINDOW_BEFORE_MS = 60 * 60 * 1000; // 1h
const EPG_WINDOW_AFTER_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Starter roster of ESPN-backed leagues (D1) — the single source of truth
 * for league id <-> ESPN's `{sport}/{league}` URL scheme, used both to
 * build schedule adapters and to look up real team rosters (searchTeams
 * below). League ids match what `config.sports.leagues` stores.
 */
const LEAGUES: Array<{ id: string; label: string; espnSport: string; espnLeague: string }> = [
  { id: "nfl", label: "NFL", espnSport: "football", espnLeague: "nfl" },
  { id: "nba", label: "NBA", espnSport: "basketball", espnLeague: "nba" },
  { id: "mlb", label: "MLB", espnSport: "baseball", espnLeague: "mlb" },
  { id: "nhl", label: "NHL", espnSport: "hockey", espnLeague: "nhl" },
  { id: "epl", label: "Premier League", espnSport: "soccer", espnLeague: "eng.1" },
];

export function getFollowedLeagueAdapters(): SportsAdapter[] {
  return LEAGUES.map((l) => new EspnAdapter(l.id, l.espnSport, l.espnLeague));
}

export interface TeamSearchResult {
  name: string;
  league: string;
  leagueLabel: string;
}

/** ~144 teams total across 5 leagues — small enough to cache whole, not paginated. */
const TEAM_LIST_TTL_MS = 24 * 60 * 60 * 1000; // team rosters barely ever change
let teamListCache: { teams: TeamSearchResult[]; fetchedAt: number } | null = null;

async function getAllTeams(): Promise<TeamSearchResult[]> {
  if (teamListCache && Date.now() - teamListCache.fetchedAt < TEAM_LIST_TTL_MS) {
    return teamListCache.teams;
  }

  const perLeague = await Promise.allSettled(
    LEAGUES.map(async (league) => {
      const teams = await fetchLeagueTeams(league.espnSport, league.espnLeague);
      return teams.map((t): TeamSearchResult => ({ name: t.name, league: league.id, leagueLabel: league.label }));
    }),
  );

  const teams = perLeague.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  teamListCache = { teams, fetchedAt: Date.now() };
  return teams;
}

/**
 * Real teams only (D-024) — backs the searchable team picker so a followed
 * team is always spelled exactly right and always tied to a real league,
 * instead of free text that can typo or silently belong to a league the
 * user never enabled (the actual cause of "no games today" despite a
 * followed team: getTodaysGames only fetches leagues in config.sports.leagues,
 * so an unlisted league contributes zero games regardless of followed teams).
 */
export async function searchTeams(query: string): Promise<TeamSearchResult[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const teams = await getAllTeams();
  return teams.filter((t) => t.name.toLowerCase().includes(needle)).slice(0, 20);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Case-insensitive exact match against name or abbreviation — not a
 * substring match. Followed teams come from the real ESPN search picker
 * (D-024), so they're always spelled exactly right; a raw substring check
 * doesn't need that slack and actively backfires on abbreviations, e.g.
 * the Dodgers' "LAD" is a substring of "Phila-LAD-elphia", so it was
 * matching a Phillies follower to every Dodgers game too.
 */
function teamIsFollowed(team: { name: string; abbreviation?: string }, followedTeams: string[]): boolean {
  const name = normalize(team.name);
  const abbr = team.abbreviation ? normalize(team.abbreviation) : null;
  return followedTeams.some((raw) => {
    const needle = normalize(raw);
    if (!needle) return false;
    return name === needle || abbr === needle;
  });
}

/**
 * Today's games (D3), each with `matchedChannels` populated (D4) via the
 * real network/EPG-title/manual-override pipeline, sorted by start time.
 * Returns `[]` whenever sports is off or nothing is followed (D8) — a
 * normal, fully-supported state, not an error.
 *
 * "Leagues" and "teams" are independent, not nested (D-024 revised): a
 * checked league means "show me that league's whole slate"; a followed
 * team means "show me that team's games, wherever it plays" — including a
 * league you never checked. Earlier this fetched only checked leagues and
 * then filtered *all* of them down to followed teams whenever any were
 * set, which broke both directions at once: unchecking a league hid a
 * followed team's games entirely (nothing was even fetched for it), and
 * checking a league still hid the rest of that league's slate the moment
 * any team anywhere was followed. Fetching every league whenever a team is
 * followed, then keeping a game if EITHER its league is checked OR it has
 * a followed team, fixes both.
 */
export async function getTodaysMatchedGames(): Promise<Game[]> {
  const config = await readConfig();
  if (!config.sports.enabled) return [];
  if (config.sports.leagues.length === 0 && config.sports.teams.length === 0) return [];

  const adapters = getFollowedLeagueAdapters();
  const leaguesToFetch =
    config.sports.teams.length > 0 ? adapters.map((a) => a.league) : config.sports.leagues;
  const games = await getTodaysGames(adapters, leaguesToFetch);
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
  const followedLeagues = new Set(config.sports.leagues);
  const filtered = games.filter(
    (game) =>
      followedLeagues.has(game.league) ||
      teamIsFollowed(game.home, followedTeams) ||
      teamIsFollowed(game.away, followedTeams),
  );

  return filtered.slice().sort((a, b) => a.startTime - b.startTime);
}
