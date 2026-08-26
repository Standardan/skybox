/**
 * Game -> channel matching engine (ARCH-R4, 04-INTEGRATIONS §6). This is the
 * primary sports path (D-012: IPTV-first), not a nice-to-have.
 *
 * Deliberately decoupled from the epg module: callers pass an
 * already-populated `EpgProgramme[]` rather than this module querying EPG
 * storage itself.
 */
import type { Channel, ChannelMatch, EpgProgramme, Game } from "../shared/types.js";
import { NETWORK_ALIASES, normalizeChannelName } from "./network-aliases.js";

/** Games run long; use a fixed generous window for EPG title matching. */
const EPG_MATCH_WINDOW_MS = 4 * 60 * 60 * 1000;

const NETWORK_MATCH_CONFIDENCE = 0.9;
const EPG_TITLE_MATCH_CONFIDENCE = 0.7;
const MANUAL_OVERRIDE_CONFIDENCE = 1;
// Above a plain network-alias guess (0.9): a team-history hint is a channel
// Dan personally confirmed carried this team before, not an inference.
const TEAM_HISTORY_CONFIDENCE = 0.95;

/**
 * Some names ESPN reports in `broadcasts[].names[]` aren't broadcast
 * channels at all — they're streaming-only placeholders (a league's or a
 * team's own DTC app) that will never correspond to a real IPTV channel.
 * Matching these via the raw-name fallback produced real false positives:
 * team-branded feeds are just "<team nickname/city>.TV" (e.g. "Rays.TV"),
 * short and generic enough to coincidentally appear as adjacent words
 * inside an unrelated channel's name (an MLB "Reds.TV" placeholder matched
 * a Scottish football channel literally named "...(Reds TV)"). Excluded
 * before matching is attempted at all, rather than trying to out-clever the
 * matcher into rejecting every case like this after the fact.
 */
const NON_CHANNEL_NETWORK_PATTERN = /\.tv$/i;
const NON_CHANNEL_NETWORK_NAMES = new Set(["espn unlmtd", "espn unlimited"]);

function isNonChannelNetworkName(network: string): boolean {
  return NON_CHANNEL_NETWORK_PATTERN.test(network.trim()) || NON_CHANNEL_NETWORK_NAMES.has(network.trim().toLowerCase());
}

/**
 * Step 1 of the pipeline: broadcast network from schedule data vs
 * normalized channel names, using the alias dictionary (with a raw-name
 * fallback for networks we haven't catalogued yet).
 */
export function matchByNetwork(game: Game, channels: Channel[]): ChannelMatch[] {
  const best = new Map<string, ChannelMatch>();

  for (const network of game.broadcastNetworks) {
    if (isNonChannelNetworkName(network)) continue;
    const { aliases, fromDictionary } = resolveAliases(network);
    for (const channel of channels) {
      const normalizedChannel = normalizeChannelName(channel.name);
      // Loose (word-order-independent) matching is only safe for aliases we
      // curated ourselves — a short/generic raw ESPN broadcast name (e.g.
      // schedule data reports team-branded streaming feeds like "Rays.TV",
      // not a real channel) can share common words with an unrelated
      // channel ("RAYS SOMALI TV") if matched that loosely. The raw-name
      // fallback below therefore requires a strict contiguous substring.
      const channelWords = normalizedChannel.split(" ").filter(Boolean);
      const isMatch = fromDictionary
        ? aliases.some((alias) => aliasMatches(normalizedChannel, alias))
        : aliases.some((alias) => containsWordSequence(channelWords, alias.split(" ").filter(Boolean)));
      if (!isMatch) continue;
      upsertBest(best, { channelId: channel.id, confidence: NETWORK_MATCH_CONFIDENCE, reason: "network" });
    }
  }

  return Array.from(best.values());
}

/**
 * Step 2 of the pipeline: fuzzy-match the matchup (team names/abbreviations)
 * against EPG programme titles whose time window overlaps the game.
 * `EpgProgramme.channelId` corresponds to `Channel.epgChannelId`, not
 * `Channel.id` — join through that field.
 */
export function matchByEpgTitle(
  game: Game,
  epgProgrammes: EpgProgramme[],
  channels: Channel[],
): ChannelMatch[] {
  const windowStart = game.startTime;
  const windowEnd = game.startTime + EPG_MATCH_WINDOW_MS;
  const best = new Map<string, ChannelMatch>();

  for (const programme of epgProgrammes) {
    const overlapsWindow = programme.start < windowEnd && programme.stop > windowStart;
    if (!overlapsWindow) continue;

    const title = programme.title.toLowerCase();
    if (!mentionsTeam(title, game.home) || !mentionsTeam(title, game.away)) continue;

    const channel = channels.find((c) => c.epgChannelId === programme.channelId);
    if (!channel) continue;

    upsertBest(best, { channelId: channel.id, confidence: EPG_TITLE_MATCH_CONFIDENCE, reason: "epg-title" });
  }

  return Array.from(best.values());
}

/**
 * Stable key for a team's learned channel history, independent of any one
 * game/event id. Same league + same (lowercased/trimmed) team display name
 * -> same key across every game that team plays, so a correction made on
 * one game's broadcast applies to every future one. Exported so the web
 * app's override API route can compute the identical key when saving a
 * correction (matcher.ts is the single source of truth for the format).
 */
export function teamHintKey(league: string, teamName: string): string {
  return `${league.trim().toLowerCase()}:${teamName.trim().toLowerCase()}`;
}

/**
 * Step 3 of the pipeline (the "teaches the mapping" half of D4/ARCH-R4):
 * channels Dan has manually confirmed before for either team in this game,
 * via a past correction on a *different* game. Broadcast schedule data
 * (ESPN) frequently omits or renames the real regional network for
 * local-only games — this lets a single correction fix every future game
 * for that team, without us guessing at currently-accurate network names
 * ourselves (a genuinely volatile, fast-changing landscape — see OQ-19).
 */
export function matchByTeamHistory(
  game: Game,
  channels: Channel[],
  teamChannelHints: Record<string, string[]>,
): ChannelMatch[] {
  const channelIds = new Set(channels.map((c) => c.id));
  const hinted = new Set<string>();
  for (const team of [game.home, game.away]) {
    const hints = teamChannelHints[teamHintKey(game.league, team.name)] ?? [];
    for (const channelId of hints) {
      if (channelIds.has(channelId)) hinted.add(channelId);
    }
  }
  return Array.from(hinted, (channelId) => ({
    channelId,
    confidence: TEAM_HISTORY_CONFIDENCE,
    reason: "team-history" as const,
  }));
}

/**
 * Public entry point (04-INTEGRATIONS §6 step 3): manual override always
 * wins; otherwise run network match, team-history hints, and EPG-title
 * match, merge by channel (keeping the higher confidence per channel), and
 * sort descending.
 */
export function matchGameToChannels(
  game: Game,
  channels: Channel[],
  epgProgrammes: EpgProgramme[],
  overrides: Record<string, string>,
  teamChannelHints: Record<string, string[]> = {},
): ChannelMatch[] {
  const overrideChannelId = overrides[game.id];
  if (overrideChannelId) {
    return [{ channelId: overrideChannelId, confidence: MANUAL_OVERRIDE_CONFIDENCE, reason: "manual-override" }];
  }

  const merged = new Map<string, ChannelMatch>();
  for (const match of matchByNetwork(game, channels)) upsertBest(merged, match);
  for (const match of matchByTeamHistory(game, channels, teamChannelHints)) upsertBest(merged, match);
  for (const match of matchByEpgTitle(game, epgProgrammes, channels)) upsertBest(merged, match);

  return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Aliases are run through the same normalization as channel names (strips
 * punctuation, quality tags, etc.) so a dictionary entry written as
 * "AT&T SportsNet" or "Pac-12 Network" matches a channel whose name uses
 * different punctuation for the same words, rather than requiring the
 * dictionary to hand-author every punctuation variant. `fromDictionary`
 * tells the caller whether these are our own curated, safe-to-loosely-match
 * phrases, or an unvetted raw name straight from the schedule source.
 */
function resolveAliases(network: string): { aliases: string[]; fromDictionary: boolean } {
  const key = Object.keys(NETWORK_ALIASES).find((k) => k.toLowerCase() === network.toLowerCase());
  const dictAliases = key ? NETWORK_ALIASES[key] : undefined;
  const aliases = (dictAliases ?? [network]).map((alias) => normalizeChannelName(alias));
  return { aliases, fromDictionary: dictAliases !== undefined };
}

/**
 * True if `alias` appears in `normalizedChannel` as a contiguous, word-
 * aligned sequence (see `containsWordSequence`), or — for multi-word
 * aliases only — as the same set of whole words regardless of order/
 * spacing (handles "Sports 1 Fox" vs "Fox Sports 1"). That second, looser
 * check is safe here specifically because dictionary aliases are curated
 * by us; it's deliberately NOT applied to the raw schedule-name fallback
 * (see matchByNetwork), which could scatter-match an unrelated channel that
 * merely happens to share the same words in different places.
 */
function aliasMatches(normalizedChannel: string, alias: string): boolean {
  if (!alias) return false;
  const aliasWords = alias.split(" ").filter(Boolean);
  const channelWords = normalizedChannel.split(" ").filter(Boolean);
  if (containsWordSequence(channelWords, aliasWords)) return true;

  if (aliasWords.length < 2) return false;
  const channelWordSet = new Set(channelWords);
  return aliasWords.every((word) => channelWordSet.has(word));
}

/**
 * True if `aliasWords` occurs in `channelWords` as a contiguous run in the
 * same order, where each alias word either equals the corresponding channel
 * word exactly, or — for alias words of 3+ characters — is a prefix of it.
 * The prefix tolerance handles real provider abbreviations ("net" for
 * "network", "sportsnet" already whole) without opening up substring
 * matching in general: a bare word like "sny" must start a channel word to
 * count, so it correctly rejects "Disny" (sny is embedded at the *end* of
 * that word, not the start) while still matching "SNY HD"/"SNY Network".
 */
function containsWordSequence(channelWords: string[], aliasWords: string[]): boolean {
  if (aliasWords.length === 0) return false;
  for (let start = 0; start <= channelWords.length - aliasWords.length; start++) {
    let matched = true;
    for (let i = 0; i < aliasWords.length; i++) {
      const aliasWord = aliasWords[i]!;
      const channelWord = channelWords[start + i]!;
      if (aliasWord === channelWord) continue;
      if (aliasWord.length >= 3 && channelWord.startsWith(aliasWord)) continue;
      matched = false;
      break;
    }
    if (matched) return true;
  }
  return false;
}

/**
 * True if `phrase` occurs in `text` on word boundaries — not merely as a
 * contiguous substring, which would let e.g. "tb" match inside "outbound"
 * or "sny" match inside "disny". Used for free-text EPG titles (raw
 * sentences with punctuation), where `\b` treats punctuation as a boundary
 * too, so "Bills," still matches the bare word "bills".
 */
function containsWholeWordPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function mentionsTeam(lowerTitle: string, team: { name: string; abbreviation?: string }): boolean {
  const candidates = new Set<string>();
  candidates.add(team.name.toLowerCase());
  if (team.abbreviation) candidates.add(team.abbreviation.toLowerCase());
  const nickname = team.name.trim().split(/\s+/).pop();
  if (nickname && nickname.length > 2) candidates.add(nickname.toLowerCase());

  for (const candidate of candidates) {
    // Short (<=3 char) candidates are almost always abbreviations (e.g. "TB",
    // "NYY") — matching them as whole words still leaves real collision risk
    // in free-text EPG titles, so require a bit more length there than for
    // full names/nicknames.
    const minLength = candidate.includes(" ") ? 2 : 3;
    if (candidate.length >= minLength && containsWholeWordPhrase(lowerTitle, candidate)) return true;
  }
  return false;
}

function upsertBest(map: Map<string, ChannelMatch>, match: ChannelMatch): void {
  const existing = map.get(match.channelId);
  if (!existing || match.confidence > existing.confidence) {
    map.set(match.channelId, match);
  }
}
