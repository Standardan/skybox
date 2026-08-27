/** Convenience aggregator over multiple per-league `SportsAdapter`s. */
import type { Game, SportsAdapter } from "../shared/types.js";

/**
 * Fetches today's schedule from every adapter whose `.league` is in
 * `leagues`. Uses `Promise.allSettled` so one bad/unavailable league
 * doesn't take the rest down with it (ARCH-R5). `timezone` decides which
 * calendar day "today" actually is — see EspnAdapter's formatDate.
 */
export async function getTodaysGames(adapters: SportsAdapter[], leagues: string[], timezone: string): Promise<Game[]> {
  const targets = adapters.filter((adapter) => leagues.includes(adapter.league));
  const results = await Promise.allSettled(targets.map((adapter) => adapter.getSchedule(new Date(), timezone)));

  const games: Game[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      games.push(...result.value);
    }
  }
  return games;
}
