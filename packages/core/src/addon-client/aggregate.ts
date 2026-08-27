import type { AddonRef, StremioStream } from "../shared/types.js";
import { getStreams } from "./streams.js";

/**
 * Matches "cached" indicator conventions used by debrid-backed stream addons,
 * e.g. Torrentio's `[RD+]`, or `PM+`/`AD+`/`TB+`/`DL+` for other debrid
 * providers, a lightning-bolt glyph, or the literal word "cached".
 */
const CACHED_PATTERN = /\[?\b(?:rd|pm|ad|tb|dl)\+\]?|⚡|\bcached\b/i;

/**
 * Release-title audio-codec hints browsers generally can't decode at all
 * in a plain <video> element — AC3/E-AC3 (DD/DDP), DTS (incl. DTS-HD MA),
 * TrueHD, and Atmos are all patent-encumbered codecs no major browser
 * ships a decoder for. The video track still plays fine (it's a totally
 * separate decoder), so this shows up as "it plays, there's just no
 * sound" — easy to mistake for a Skybox bug rather than what it actually
 * is: a release whose audio format the browser can't touch. AAC/MP3/
 * Opus/FLAC (not matched here) all decode natively.
 */
const LIKELY_INCOMPATIBLE_AUDIO_PATTERN = /\b(?:ddp?\d(?:\.\d)?|dd\+|e-?ac-?3|eac-?3|ac-?3|dts(?:-?hd)?(?:\.?ma)?|true-?hd|atmos)\b/i;

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

/** Exported so UI layers can warn ("this release's audio likely won't play") using the exact same detection `aggregateStreams` ranks by. */
export function hasLikelyIncompatibleAudio(stream: StremioStream): boolean {
  return LIKELY_INCOMPATIBLE_AUDIO_PATTERN.test(streamText(stream));
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
 * (2160p > 1080p > 720p > other), then browser-playable audio ahead of a
 * release whose audio codec a browser almost certainly can't decode (a
 * tertiary tiebreaker only — never overrides the cached/resolution
 * ranking, just picks the more likely-to-actually-have-sound option
 * between two otherwise-equal candidates), stable otherwise (original —
 * i.e. per-addon arrival — order is preserved for ties). Array.prototype.sort
 * is stable per spec, but we also carry the original index as an explicit
 * tiebreaker so ranking behavior doesn't depend on engine internals.
 */
function rankStreams(streams: StremioStream[]): StremioStream[] {
  return streams
    .map((stream, index) => ({ stream, index }))
    .sort((a, b) => {
      const cachedDiff = Number(!isCached(a.stream)) - Number(!isCached(b.stream));
      if (cachedDiff !== 0) return cachedDiff;
      const resolutionDiff = resolutionRank(a.stream) - resolutionRank(b.stream);
      if (resolutionDiff !== 0) return resolutionDiff;
      const audioDiff = Number(hasLikelyIncompatibleAudio(a.stream)) - Number(hasLikelyIncompatibleAudio(b.stream));
      if (audioDiff !== 0) return audioDiff;
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
