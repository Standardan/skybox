import { describe, expect, it } from "vitest";
import type { Channel, EpgProgramme, Game } from "../shared/types.js";
import { matchByEpgTitle, matchByNetwork, matchByTeamHistory, matchGameToChannels, teamHintKey } from "./matcher.js";

function makeChannel(overrides: Partial<Channel> & { id: string; name: string }): Channel {
  return {
    providerId: "provider-1",
    category: "Sports",
    streamUrls: [`http://example.com/${overrides.id}`],
    streamFormat: "hls",
    ...overrides,
  };
}

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    league: "nfl",
    home: { name: "New York Jets", abbreviation: "NYJ" },
    away: { name: "Buffalo Bills", abbreviation: "BUF" },
    startTime: Date.UTC(2026, 8, 10, 17, 0, 0),
    status: "upcoming",
    broadcastNetworks: [],
    matchedChannels: [],
    ...overrides,
  };
}

describe("matchByNetwork", () => {
  it("matches via the alias dictionary (ESPN -> normalized 'espn')", () => {
    const game = makeGame({ broadcastNetworks: ["ESPN"] });
    const channels = [
      makeChannel({ id: "c1", name: "US: ESPN HD" }),
      makeChannel({ id: "c2", name: "Cartoon Network" }),
    ];

    const matches = matchByNetwork(game, channels);

    expect(matches).toEqual([{ channelId: "c1", confidence: 0.9, reason: "network" }]);
  });

  it("falls back to the raw network name as its own alias when not in the dictionary", () => {
    const game = makeGame({ broadcastNetworks: ["Bally Sports SoCal"] });
    const channels = [
      makeChannel({ id: "c1", name: "Bally Sports SoCal HD" }),
      makeChannel({ id: "c2", name: "ESPN" }),
    ];

    const matches = matchByNetwork(game, channels);

    expect(matches).toEqual([{ channelId: "c1", confidence: 0.9, reason: "network" }]);
  });

  it("dedupes a channel matched by multiple networks, keeping one entry", () => {
    const game = makeGame({ broadcastNetworks: ["ESPN", "ESPN2"] });
    const channels = [makeChannel({ id: "c1", name: "ESPN HD" })];

    const matches = matchByNetwork(game, channels);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({ channelId: "c1", confidence: 0.9, reason: "network" });
  });

  it("returns no matches when no channel name overlaps any alias", () => {
    const game = makeGame({ broadcastNetworks: ["CBS"] });
    const channels = [makeChannel({ id: "c1", name: "Cartoon Network" })];

    expect(matchByNetwork(game, channels)).toEqual([]);
  });

  it("matches a real-world regional sports network name despite punctuation differences", () => {
    const game = makeGame({ broadcastNetworks: ["Bally Sports"] });
    const channels = [
      makeChannel({ id: "c1", name: "USA| Bally Sports (Detroit) HD" }),
      makeChannel({ id: "c2", name: "ESPN" }),
    ];

    expect(matchByNetwork(game, channels)).toEqual([{ channelId: "c1", confidence: 0.9, reason: "network" }]);
  });

  it("matches an alias regardless of word order in the channel name", () => {
    const game = makeGame({ broadcastNetworks: ["FS1"] });
    const channels = [makeChannel({ id: "c1", name: "Sports 1 Fox HD" })];

    // "fox sports 1" is a listed alias for FS1 — the channel says the words in a different order.
    expect(matchByNetwork(game, channels)).toEqual([{ channelId: "c1", confidence: 0.9, reason: "network" }]);
  });

  it("does not false-positive-match 'USA Network' against an unrelated USA-prefixed channel", () => {
    const game = makeGame({ broadcastNetworks: ["USA Network"] });
    const channels = [makeChannel({ id: "c1", name: "USA: ESPN HD" })];

    expect(matchByNetwork(game, channels)).toEqual([]);
  });

  it("does not loosely word-match an unvetted raw schedule name against an unrelated channel (regression)", () => {
    // Real case: ESPN reports a team-branded MLB.TV placeholder feed
    // ("Rays.TV") for a game with no real broadcast channel. It must not
    // token-match a channel that happens to share both words ("rays", "tv")
    // in a totally unrelated name — only the curated dictionary gets that
    // loose word-order-independent matching; raw fallback names don't.
    const game = makeGame({ broadcastNetworks: ["Rays.TV"] });
    const channels = [makeChannel({ id: "c1", name: "SOM: Rays Somali TV" })];

    expect(matchByNetwork(game, channels)).toEqual([]);
  });

  it("matches a real-world abbreviated raw schedule name against the channel's unabbreviated word (regression)", () => {
    // Real case: ESPN reports "Marquee Sports Net" (abbreviated) for a game
    // whose actual IPTV channel is named "...Marquee Sports Network...".
    // "net" is a real prefix of "network", so this must still match, while
    // the earlier scattered-words case (Rays.TV / "Rays Somali TV") must not.
    const game = makeGame({ broadcastNetworks: ["Marquee Sports Net"] });
    const channels = [makeChannel({ id: "c1", name: "US: Marquee Sports Network HD" })];

    expect(matchByNetwork(game, channels)).toEqual([{ channelId: "c1", confidence: 0.9, reason: "network" }]);
  });

  it("skips team-branded streaming placeholders entirely rather than matching them as channels (regression)", () => {
    // Real case: ESPN reports "Reds.TV" (a team-app streaming placeholder,
    // never a real broadcast channel) for a game with no real TV coverage.
    // It must not be attempted against the channel list at all — a Scottish
    // football channel literally named "...(Reds TV)" would otherwise match.
    const game = makeGame({ broadcastNetworks: ["MLB.TV", "Reds.TV", "Giants.TV"] });
    const channels = [makeChannel({ id: "c1", name: "SPFL: Aberdeen FC (Reds TV)" })];

    expect(matchByNetwork(game, channels)).toEqual([]);
  });

  it("does not match a short dictionary alias as a substring inside an unrelated word (regression)", () => {
    // Real case: bare alias "sny" (a real regional network) must not match
    // inside "Disny" — a mistyped "Disney" channel that happens to contain
    // the letters s-n-y contiguously.
    const game = makeGame({ broadcastNetworks: ["SNY"] });
    const channels = [makeChannel({ id: "c1", name: "AL: Albania Disny 4K" })];

    expect(matchByNetwork(game, channels)).toEqual([]);
  });
});

describe("matchByEpgTitle", () => {
  const game = makeGame({ startTime: Date.UTC(2026, 8, 10, 17, 0, 0) });

  it("matches a programme whose window overlaps the game and whose title mentions both teams", () => {
    const channels = [makeChannel({ id: "c1", name: "Local Sports", epgChannelId: "epg-42" })];
    const programmes: EpgProgramme[] = [
      {
        channelId: "epg-42",
        title: "NFL Football: Jets at Bills",
        start: Date.UTC(2026, 8, 10, 17, 30, 0), // 30 min after kickoff, inside 4h window
        stop: Date.UTC(2026, 8, 10, 20, 30, 0),
      },
    ];

    const matches = matchByEpgTitle(game, programmes, channels);

    expect(matches).toEqual([{ channelId: "c1", confidence: 0.7, reason: "epg-title" }]);
  });

  it("does not match a programme whose window does not overlap the game", () => {
    const channels = [makeChannel({ id: "c1", name: "Local Sports", epgChannelId: "epg-42" })];
    const programmes: EpgProgramme[] = [
      {
        channelId: "epg-42",
        title: "NFL Football: Jets at Bills",
        // starts 10 hours after kickoff -> well outside the 4h window
        start: Date.UTC(2026, 8, 11, 3, 0, 0),
        stop: Date.UTC(2026, 8, 11, 6, 0, 0),
      },
    ];

    expect(matchByEpgTitle(game, programmes, channels)).toEqual([]);
  });

  it("does not match when the title only mentions one of the two teams", () => {
    const channels = [makeChannel({ id: "c1", name: "Local Sports", epgChannelId: "epg-42" })];
    const programmes: EpgProgramme[] = [
      {
        channelId: "epg-42",
        title: "Jets Pregame Show",
        start: Date.UTC(2026, 8, 10, 17, 0, 0),
        stop: Date.UTC(2026, 8, 10, 18, 0, 0),
      },
    ];

    expect(matchByEpgTitle(game, programmes, channels)).toEqual([]);
  });

  it("does not match on a bare 2-letter team abbreviation appearing coincidentally in unrelated text", () => {
    // "TB" (Tampa Bay) and "DET" would both appear as raw substrings in
    // plenty of unrelated free text; 2-letter abbreviations are excluded
    // from EPG-title matching entirely (full name/nickname still work).
    const twoLetterGame = makeGame({
      home: { name: "Tampa Bay Rays", abbreviation: "TB" },
      away: { name: "Detroit Tigers", abbreviation: "DET" },
    });
    const channels = [makeChannel({ id: "c1", name: "Foreign Sports", epgChannelId: "epg-42" })];
    const programmes: EpgProgramme[] = [
      {
        channelId: "epg-42",
        title: "Outbound Travel and Detour Guide", // contains "tb" and "det" as raw substrings, no real mention
        start: twoLetterGame.startTime,
        stop: twoLetterGame.startTime + 60 * 60 * 1000,
      },
    ];

    expect(matchByEpgTitle(twoLetterGame, programmes, channels)).toEqual([]);
  });

  it("joins EpgProgramme.channelId to Channel.epgChannelId, not Channel.id", () => {
    // Channel.id intentionally differs from the epg channel id to prove the join is correct.
    const channels = [makeChannel({ id: "internal-channel-id", name: "Local Sports", epgChannelId: "epg-42" })];
    const programmes: EpgProgramme[] = [
      {
        channelId: "epg-42",
        title: "Jets vs Bills",
        start: Date.UTC(2026, 8, 10, 17, 0, 0),
        stop: Date.UTC(2026, 8, 10, 20, 0, 0),
      },
    ];

    const matches = matchByEpgTitle(game, programmes, channels);
    expect(matches).toEqual([{ channelId: "internal-channel-id", confidence: 0.7, reason: "epg-title" }]);
  });
});

describe("matchGameToChannels", () => {
  it("returns the manual override immediately, ignoring network/epg matches", () => {
    const game = makeGame({ id: "game-42", broadcastNetworks: ["ESPN"] });
    const channels = [makeChannel({ id: "c1", name: "ESPN HD" })];
    const overrides = { "game-42": "manual-channel-id" };

    const matches = matchGameToChannels(game, channels, [], overrides);

    expect(matches).toEqual([{ channelId: "manual-channel-id", confidence: 1, reason: "manual-override" }]);
  });

  it("merges network and EPG matches, keeping the higher confidence per channel, sorted descending", () => {
    const game = makeGame({ id: "game-7", broadcastNetworks: ["ESPN"] });

    // c1: matched by BOTH network (0.9) and epg-title (0.7) -> keep 0.9/network.
    // c2: matched only by epg-title (0.7).
    const channels = [
      makeChannel({ id: "c1", name: "ESPN HD", epgChannelId: "epg-c1" }),
      makeChannel({ id: "c2", name: "Regional Sports Net", epgChannelId: "epg-c2" }),
    ];

    const programmes: EpgProgramme[] = [
      {
        channelId: "epg-c1",
        title: "Jets at Bills",
        start: game.startTime,
        stop: game.startTime + 60 * 60 * 1000,
      },
      {
        channelId: "epg-c2",
        title: "Jets vs Bills Broadcast",
        start: game.startTime,
        stop: game.startTime + 60 * 60 * 1000,
      },
    ];

    const matches = matchGameToChannels(game, channels, programmes, {});

    expect(matches).toEqual([
      { channelId: "c1", confidence: 0.9, reason: "network" },
      { channelId: "c2", confidence: 0.7, reason: "epg-title" },
    ]);
  });

  it("returns an empty array when nothing matches", () => {
    const game = makeGame({ id: "game-9", broadcastNetworks: ["CBS"] });
    const channels = [makeChannel({ id: "c1", name: "Cartoon Network" })];

    expect(matchGameToChannels(game, channels, [], {})).toEqual([]);
  });

  it("prefers a team-history hint over a network match for the same game", () => {
    // c1 matches by network (ESPN, 0.9); c2 was manually confirmed before
    // for the Jets (0.95) — a past correction should outrank a fresh guess.
    const game = makeGame({ id: "game-10", broadcastNetworks: ["ESPN"] });
    const channels = [
      makeChannel({ id: "c1", name: "ESPN HD" }),
      makeChannel({ id: "c2", name: "MSG Network" }),
    ];
    const hints = { [teamHintKey("nfl", "New York Jets")]: ["c2"] };

    const matches = matchGameToChannels(game, channels, [], {}, hints);

    expect(matches).toEqual([
      { channelId: "c2", confidence: 0.95, reason: "team-history" },
      { channelId: "c1", confidence: 0.9, reason: "network" },
    ]);
  });

  it("a per-game manual override still wins over a team-history hint", () => {
    const game = makeGame({ id: "game-11" });
    const channels = [makeChannel({ id: "c1", name: "MSG Network" })];
    const hints = { [teamHintKey("nfl", "New York Jets")]: ["c1"] };

    const matches = matchGameToChannels(game, channels, [], { "game-11": "other-channel" }, hints);

    expect(matches).toEqual([{ channelId: "other-channel", confidence: 1, reason: "manual-override" }]);
  });
});

describe("matchByTeamHistory", () => {
  it("matches a channel hinted for either the home or away team", () => {
    const game = makeGame();
    const channels = [makeChannel({ id: "c1", name: "MSG Network" }), makeChannel({ id: "c2", name: "NESN" })];
    const hints = {
      [teamHintKey("nfl", "New York Jets")]: ["c1"],
      [teamHintKey("nfl", "Buffalo Bills")]: ["c2"],
    };

    const matches = matchByTeamHistory(game, channels, hints);

    expect(matches.sort((a, b) => a.channelId.localeCompare(b.channelId))).toEqual([
      { channelId: "c1", confidence: 0.95, reason: "team-history" },
      { channelId: "c2", confidence: 0.95, reason: "team-history" },
    ]);
  });

  it("ignores a hinted channel id that no longer exists in the channel list", () => {
    const game = makeGame();
    const channels = [makeChannel({ id: "c1", name: "MSG Network" })];
    const hints = { [teamHintKey("nfl", "New York Jets")]: ["stale-channel-id"] };

    expect(matchByTeamHistory(game, channels, hints)).toEqual([]);
  });

  it("is scoped by league — a same-named team in a different league doesn't match", () => {
    const game = makeGame({ league: "nfl" });
    const channels = [makeChannel({ id: "c1", name: "MSG Network" })];
    const hints = { [teamHintKey("nhl", "New York Jets")]: ["c1"] };

    expect(matchByTeamHistory(game, channels, hints)).toEqual([]);
  });
});
