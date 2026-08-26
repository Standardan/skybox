import type { AddonRef, StremioStream } from "../shared/types.js";
import { getStreams } from "./streams.js";

/**
 * Matches "cached" indicator conventions used by debrid-backed stream addons,
 * e.g. Torrentio's `[RD+]`, or `PM+`/`AD+`/`TB+`/`DL+` for other debrid
 * providers, a lightning-bolt glyph, or the literal word "cached".
 */
const CACHED_PATTERN = /\[?\b(?:rd|pm|ad|tb|dl)\+\]?|⚡|\bcached\b/i;

const RESOLUTION_PATTERNS: Array<{ rank: number; pattern: RegExp }> = [
  { rank: 0, pattern: /2160p|\b4k\b|\buhd\b/i },
  { rank: 1, pattern: /1080p/i },
  { rank: 2, pattern: /720p/i },
];
const UNKNOWN_RESOLUTION_RANK = RESOLUTION_PATTERNS.length;

function streamText(stream: StremioStream): string {
  return `${stream.name ?? ""} ${stream.title ?? ""}`;
}

/** Exported so UI layers (badges, preference-driven re-sorting) use the exact same detection `aggregateStreams` ranks by. */
export function isCached(stream: StremioStream): boolean {
  return CACHED_PATTERN.test(streamText(stream));
}

function resolutionRank(stream: StremioStream): number {
  const text = streamText(stream);
  for (const { rank, pattern } of RESOLUTION_PATTERNS) {
    if (pattern.test(text)) return rank;
  }
  return UNKNOWN_RESOLUTION_RANK;
}

const RESOLUTION_LABELS = ["2160p", "1080p", "720p"] as const;

/** Exported for preference-driven re-sorting (e.g. "prefer 1080p") — same detection `aggregateStreams` ranks by. */
export function detectResolution(stream: StremioStream): (typeof RESOLUTION_LABELS)[number] | "unknown" {
  const rank = resolutionRank(stream);
  return RESOLUTION_LABELS[rank] ?? "unknown";
}

/** `url`, else `infoHash+fileIdx`, else undefined (nothing stable to key on). */
function dedupeKey(stream: StremioStream): string | undefined {
  if (stream.url) return `url:${stream.url}`;
  if (stream.infoHash) return `hash:${stream.infoHash.toLowerCase()}:${stream.fileIdx ?? ""}`;
  return undefined;
}

/**
 * Drop duplicate streams (same `url`, or same `infoHash`+`fileIdx`) that
 * different addons resolved to the same source. Streams carrying a
 * `behaviorHints.bingeGroup` are left untouched — binge groups link related
 * episodes/releases together and collapsing them would break that chain even
 * when two entries otherwise look identical.
 */
function dedupeStreams(streams: StremioStream[]): StremioStream[] {
  const seen = new Set<string>();
  const out: StremioStream[] = [];
  for (const stream of streams) {
    if (stream.behaviorHints?.bingeGroup) {
      out.push(stream);
      continue;
    }
    const key = dedupeKey(stream);
    if (key === undefined) {
      out.push(stream);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(stream);
  }
  return out;
}

/**
 * Rank streams: cached (RD+/PM+/... labeled) first, then by resolution hint
 * (2160p > 1080p > 720p > other), stable otherwise (original — i.e. per-addon
 * arrival — order is preserved for ties). Array.prototype.sort is stable per
 * spec, but we also carry the original index as an explicit tiebreaker so
 * ranking behavior doesn't depend on engine internals.
 */
function rankStreams(streams: StremioStream[]): StremioStream[] {
  return streams
    .map((stream, index) => ({ stream, index }))
    .sort((a, b) => {
      const cachedDiff = Number(!isCached(a.stream)) - Number(!isCached(b.stream));
      if (cachedDiff !== 0) return cachedDiff;
      const resolutionDiff = resolutionRank(a.stream) - resolutionRank(b.stream);
      if (resolutionDiff !== 0) return resolutionDiff;
      return a.index - b.index;
    })
    .map(({ stream }) => stream);
}

/**
 * Query `getStreams` across all enabled addons concurrently, tolerating
 * individual addon failures (a slow/broken addon must not block the others),
 * then flatten, dedupe, and rank the combined result.
 */
export async function aggregateStreams(
  addons: AddonRef[],
  type: string,
  id: string,
): Promise<StremioStream[]> {
  const enabled = addons.filter((addon) => addon.enabled);
  const results = await Promise.allSettled(enabled.map((addon) => getStreams(addon, type, id)));

  const flattened: StremioStream[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      flattened.push(...result.value);
    }
    // A rejected addon is skipped — Promise.allSettled is exactly what keeps
    // one bad addon (timeout, malformed JSON, ...) from failing the rest.
  }

  return rankStreams(dedupeStreams(flattened));
}
