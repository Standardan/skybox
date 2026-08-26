import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLeagueTeams } from "./teams.js";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

describe("fetchLeagueTeams", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("extracts name/abbreviation from the real ESPN teams response shape", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        sports: [
          {
            leagues: [
              {
                teams: [
                  { team: { displayName: "Philadelphia Phillies", abbreviation: "PHI" } },
                  { team: { displayName: "Seattle Mariners", abbreviation: "SEA" } },
                ],
              },
            ],
          },
        ],
      }),
    );

    const teams = await fetchLeagueTeams("baseball", "mlb");

    expect(mockFetch.mock.calls[0]![0]).toBe("https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams");
    expect(teams).toEqual([
      { name: "Philadelphia Phillies", abbreviation: "PHI" },
      { name: "Seattle Mariners", abbreviation: "SEA" },
    ]);
  });

  it("skips malformed entries rather than throwing", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ sports: [{ leagues: [{ teams: [{ team: { abbreviation: "NO_NAME" } }, {}] }] }] }),
    );

    expect(await fetchLeagueTeams("baseball", "mlb")).toEqual([]);
  });

  it("returns an empty array when the response has no teams at all", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    expect(await fetchLeagueTeams("baseball", "mlb")).toEqual([]);
  });
});
