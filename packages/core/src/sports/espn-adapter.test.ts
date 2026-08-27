import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EspnAdapter } from "./espn-adapter.js";

/** Trimmed-but-realistic ESPN scoreboard fixture covering pre/in/post. */
function buildScoreboardFixture() {
  return {
    events: [
      {
        id: "401547439",
        date: "2026-09-10T17:00Z",
        status: { type: { state: "pre", completed: false, description: "Scheduled" } },
        competitions: [
          {
            broadcasts: [{ market: "national", names: ["CBS"] }],
            competitors: [
              { homeAway: "home", team: { displayName: "New York Jets", abbreviation: "NYJ" } },
              { homeAway: "away", team: { displayName: "Buffalo Bills", abbreviation: "BUF" } },
            ],
          },
        ],
      },
      {
        id: "401547440",
        date: "2026-09-10T20:25Z",
        status: { type: { state: "in", completed: false, description: "In Progress" } },
        competitions: [
          {
            broadcasts: [
              { market: "national", names: ["FOX"] },
              { market: "national", names: ["FOX"] }, // duplicate on purpose -> should dedupe
            ],
            competitors: [
              { homeAway: "home", score: "17", team: { displayName: "Dallas Cowboys", abbreviation: "DAL" } },
              { homeAway: "away", score: "14", team: { displayName: "Philadelphia Eagles", abbreviation: "PHI" } },
            ],
          },
        ],
      },
      {
        id: "401547441",
        date: "2026-09-10T23:20Z",
        status: { type: { state: "post", completed: true, description: "Final" } },
        competitions: [
          {
            broadcasts: [{ market: "national", names: ["NBC", "Peacock"] }],
            competitors: [
              { homeAway: "home", score: "24", team: { displayName: "San Francisco 49ers", abbreviation: "SF" } },
              { homeAway: "away", score: "20", team: { displayName: "Seattle Seahawks", abbreviation: "SEA" } },
            ],
          },
        ],
      },
    ],
  };
}

describe("EspnAdapter", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => buildScoreboardFixture(),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the correct ESPN scoreboard URL for the given league and date", async () => {
    const adapter = new EspnAdapter("nfl", "football", "nfl");
    await adapter.getSchedule(new Date(Date.UTC(2026, 8, 10)), "UTC"); // Sept 10 2026

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20260910",
    );
  });

  it("maps ESPN status.type.state to GameStatus (pre/in/post)", async () => {
    const adapter = new EspnAdapter("nfl", "football", "nfl");
    const games = await adapter.getSchedule(new Date(Date.UTC(2026, 8, 10)), "UTC");

    expect(games).toHaveLength(3);
    expect(games[0]?.status).toBe("upcoming");
    expect(games[1]?.status).toBe("live");
    expect(games[2]?.status).toBe("final");
  });

  it("parses home/away teams, ids, league and startTime", async () => {
    const adapter = new EspnAdapter("nfl", "football", "nfl");
    const games = await adapter.getSchedule(new Date(Date.UTC(2026, 8, 10)), "UTC");
    const game = games[0];
    expect(game).toBeDefined();

    expect(game?.id).toBe("401547439");
    expect(game?.league).toBe("nfl");
    expect(game?.home).toEqual({ name: "New York Jets", abbreviation: "NYJ" });
    expect(game?.away).toEqual({ name: "Buffalo Bills", abbreviation: "BUF" });
    expect(game?.startTime).toBe(Date.parse("2026-09-10T17:00Z"));
    expect(game?.matchedChannels).toEqual([]);
  });

  it("extracts and dedupes broadcastNetworks from competitions[].broadcasts[].names[]", async () => {
    const adapter = new EspnAdapter("nfl", "football", "nfl");
    const games = await adapter.getSchedule(new Date(Date.UTC(2026, 8, 10)), "UTC");

    expect(games[1]?.broadcastNetworks).toEqual(["FOX"]); // deduped
    expect(games[2]?.broadcastNetworks).toEqual(["NBC", "Peacock"]);
  });

  it("extracts score only when status is live or final, not upcoming", async () => {
    const adapter = new EspnAdapter("nfl", "football", "nfl");
    const games = await adapter.getSchedule(new Date(Date.UTC(2026, 8, 10)), "UTC");

    expect(games[0]?.score).toBeUndefined(); // pre/upcoming
    expect(games[1]?.score).toEqual({ home: 17, away: 14 }); // in/live
    expect(games[2]?.score).toEqual({ home: 24, away: 20 }); // post/final
  });

  it("defaults unmapped status states to upcoming", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          events: [
            {
              id: "1",
              date: "2026-09-10T17:00Z",
              status: { type: { state: "postponed" } },
              competitions: [
                {
                  broadcasts: [],
                  competitors: [
                    { homeAway: "home", team: { displayName: "Home Team" } },
                    { homeAway: "away", team: { displayName: "Away Team" } },
                  ],
                },
              ],
            },
          ],
        }),
      })),
    );

    const adapter = new EspnAdapter("nba", "basketball", "nba");
    const games = await adapter.getSchedule(new Date(Date.UTC(2026, 8, 10)), "UTC");
    expect(games[0]?.status).toBe("upcoming");
  });

  /**
   * Real bug: "Today's Games" showing tomorrow's games — formatDate used
   * to read the SERVER's own local calendar day (via Date.getFullYear/
   * getMonth/getDate), not the viewer's configured timezone. A VPS
   * running in UTC is already into "tomorrow" in the evening US hours,
   * so the ESPN query used the wrong date entirely. This instant
   * (2026-09-11T02:00Z) is deliberately chosen to fall on DIFFERENT
   * calendar days in UTC vs. US Eastern — the only way to actually prove
   * the timezone argument changes which date gets queried, not just that
   * it's accepted.
   */
  it("queries the calendar day for the GIVEN timezone, not UTC or the server's own local time", async () => {
    const instant = new Date("2026-09-11T02:00:00Z"); // 2026-09-10T22:00 in America/New_York (EDT, UTC-4)

    const adapter = new EspnAdapter("nfl", "football", "nfl");
    await adapter.getSchedule(instant, "America/New_York");

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain("dates=20260910"); // still "today" in New York
  });

  it("the same instant queries a different date for a different timezone", async () => {
    const instant = new Date("2026-09-11T02:00:00Z");

    const adapter = new EspnAdapter("nfl", "football", "nfl");
    await adapter.getSchedule(instant, "UTC");

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain("dates=20260911"); // already "tomorrow" in UTC
  });
});
