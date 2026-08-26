"use server";

import type { SportsPrefs } from "@skybox/core/shared";
import { updateConfig } from "@/lib/config-store";

export async function setSportsEnabled(enabled: boolean): Promise<SportsPrefs> {
  const config = await updateConfig((c) => ({ ...c, sports: { ...c.sports, enabled } }));
  return config.sports;
}

export async function setSpoilerFree(spoilerFree: boolean): Promise<SportsPrefs> {
  const config = await updateConfig((c) => ({ ...c, sports: { ...c.sports, spoilerFree } }));
  return config.sports;
}

export async function toggleLeague(leagueId: string, followed: boolean): Promise<SportsPrefs> {
  const config = await updateConfig((c) => {
    const leagues = followed
      ? [...new Set([...c.sports.leagues, leagueId])]
      : c.sports.leagues.filter((id) => id !== leagueId);
    return { ...c, sports: { ...c.sports, leagues } };
  });
  return config.sports;
}

/**
 * `league` comes from the searchable team picker (a real ESPN league id),
 * not typed — and gets auto-enabled alongside the team. Without this, a
 * followed team whose league was never separately toggled on contributes
 * zero games to Today's Games (getTodaysGames only fetches enabled
 * leagues), which looked like "no games today" even on a real game day.
 */
export async function addTeam(name: string, league?: string): Promise<SportsPrefs> {
  const trimmed = name.trim();
  const config = await updateConfig((c) => {
    if (!trimmed || c.sports.teams.includes(trimmed)) return c;
    const leagues = league && !c.sports.leagues.includes(league) ? [...c.sports.leagues, league] : c.sports.leagues;
    return { ...c, sports: { ...c.sports, teams: [...c.sports.teams, trimmed], leagues } };
  });
  return config.sports;
}

export async function removeTeam(name: string): Promise<SportsPrefs> {
  const config = await updateConfig((c) => ({
    ...c,
    sports: { ...c.sports, teams: c.sports.teams.filter((t) => t !== name) },
  }));
  return config.sports;
}
