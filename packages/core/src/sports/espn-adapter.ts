/**
 * ESPN public scoreboard JSON adapter (04-INTEGRATIONS §5).
 * Unofficial but stable for years; includes broadcast network names, which
 * is what makes channel matching possible (ARCH-R4). Isolated behind the
 * `SportsAdapter` interface per ARCH-R5 so a breaking upstream change is
 * contained to this one file.
 */
import type { Game, GameStatus, SportsAdapter } from "../shared/types.js";
import { fetchJson } from "../shared/http.js";

// ---------------------------------------------------------------------------
// Raw ESPN response shapes (trimmed to the fields we actually read)
// ---------------------------------------------------------------------------

interface EspnTeamRef {
  displayName: string;
  abbreviation?: string;
}

interface EspnCompetitor {
  homeAway: "home" | "away";
  score?: string;
  team: EspnTeamRef;
}

interface EspnBroadcast {
  market?: string;
  names?: string[];
}

interface EspnCompetition {
  competitors?: EspnCompetitor[];
  broadcasts?: EspnBroadcast[];
}

interface EspnStatusType {
  state?: string; // 'pre' | 'in' | 'post'
  completed?: boolean;
  description?: string;
}

interface EspnEvent {
  id: string;
  date: string;
  status?: { type?: EspnStatusType };
  competitions?: EspnCompetition[];
}

interface EspnScoreboardResponse {
  events?: EspnEvent[];
}

function mapStatus(state: string | undefined): GameStatus {
  switch (state) {
    case "pre":
      return "upcoming";
    case "in":
      return "live";
    case "post":
      return "final";
    default:
      return "upcoming";
  }
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function toScore(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * `SportsAdapter` implementation backed by ESPN's public scoreboard JSON.
 * One instance per league, e.g. `new EspnAdapter('nfl', 'football', 'nfl')`
 * or `new EspnAdapter('nba', 'basketball', 'nba')`.
 */
export class EspnAdapter implements SportsAdapter {
  constructor(
    public readonly league: string,
    private readonly espnSport: string,
    private readonly espnLeague: string,
  ) {}

  async getSchedule(date: Date): Promise<Game[]> {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${this.espnSport}/${this.espnLeague}/scoreboard?dates=${formatDate(date)}`;
    const response = await fetchJson<EspnScoreboardResponse>(url);
    return (response.events ?? []).map((event) => this.toGame(event));
  }

  private toGame(event: EspnEvent): Game {
    const competition = event.competitions?.[0];
    const competitors = competition?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    const status = mapStatus(event.status?.type?.state);

    const broadcastNetworks = dedupe(
      (competition?.broadcasts ?? []).flatMap((broadcast) => broadcast.names ?? []),
    );

    const game: Game = {
      id: event.id,
      league: this.league,
      home: { name: home?.team?.displayName ?? "TBD", abbreviation: home?.team?.abbreviation },
      away: { name: away?.team?.displayName ?? "TBD", abbreviation: away?.team?.abbreviation },
      startTime: Date.parse(event.date),
      status,
      broadcastNetworks,
      matchedChannels: [],
    };

    if (status === "live" || status === "final") {
      const homeScore = toScore(home?.score);
      const awayScore = toScore(away?.score);
      if (homeScore !== undefined && awayScore !== undefined) {
        game.score = { home: homeScore, away: awayScore };
      }
    }

    return game;
  }
}
