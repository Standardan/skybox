/**
 * Real team rosters per league, from ESPN's public teams endpoint — same
 * base URL scheme as espn-adapter.ts's scoreboard calls
 * (`{sport}/{league}/teams` vs `{sport}/{league}/scoreboard`). Powers the
 * searchable team picker (D-024): typing a team name should only ever
 * offer real teams, not accept arbitrary free text a user might mistype.
 */
import { fetchJson } from "../shared/http.js";

export interface EspnTeamSummary {
  name: string; // full display name, e.g. "Philadelphia Phillies"
  abbreviation?: string;
}

interface EspnTeamsResponse {
  sports?: Array<{
    leagues?: Array<{
      teams?: Array<{ team?: { displayName?: string; abbreviation?: string } }>;
    }>;
  }>;
}

export async function fetchLeagueTeams(espnSport: string, espnLeague: string): Promise<EspnTeamSummary[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/${espnLeague}/teams`;
  const data = await fetchJson<EspnTeamsResponse>(url);
  const rawTeams = data.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return rawTeams
    .map((entry) => entry.team)
    .filter((team): team is { displayName: string; abbreviation?: string } => Boolean(team?.displayName))
    .map((team) => ({ name: team.displayName, abbreviation: team.abbreviation }));
}
