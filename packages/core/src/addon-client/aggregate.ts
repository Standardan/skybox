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

/**
 * Container formats no major browser's native <video> element can parse
 * at all — MKV above all, since it's the dominant container for anything
 * above WEBRip quality on these release ecosystems. This isn't a codec
 * problem (the video/audio inside might be perfectly playable); the
 * browser's own demuxer just doesn't recognize the container, so nothing
 * loads at all — no error event, no picture, no duration, controls that
 * don't do anything because there's nothing actually loaded to control.
 * Real report this addresses: "resolving works now, but the player opens
 * to a black/frozen screen and pause/unpause don't do anything" — after
 * confirming resolve itself succeeds, that's exactly what an unsupported
 * container looks like, not a Skybox bug. mp4/m4v/webm/mov are fine.
 */
const UNPLAYABLE_CONTAINER_EXTENSIONS = new Set(["mkv", "avi", "wmv", "flv", "ts", "m2ts", "vob", "rm", "rmvb", "divx"]);

/** Checked against the REAL resolved filename (not a title guess) — reliable, since this is the file that's actually about to be handed to <video>. */
export function isLikelyUnplayableContainer(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? UNPLAYABLE_CONTAINER_EXTENSIONS.has(ext) : false;
}

/**
 * Release-title hints for HEVC/H.265 video. Unlike the audio codecs and
 * containers above, this isn't universally unplayable — Chrome, Edge, and
 * Safari all decode HEVC (via hardware or, in recent Chrome, software)
 * on most systems. Firefox is the real holdout: it ships no HEVC decoder
 * at all outside a narrow set of platform codec packs, so this is a
 * per-viewer browser-capability question, not a fixed rule — which is
 * why (unlike hasLikelyIncompatibleAudio) this isn't wired into
 * rankStreams below; the caller combines it with an actual
 * canPlayType() check for the viewer's own browser. Real report this
 * targets: 4K/HDR/Dolby-Vision releases (near-universally HEVC, since
 * H.264 doesn't carry HDR10/DV metadata well) coming up as a black
 * screen with a MediaError METADATA code in Firefox specifically, across
 * every source tried regardless of container.
 */
const LIKELY_HEVC_PATTERN = /\b(?:x265|h\.?265|hevc|hvc1|hev1)\b/i;

/** Exported so UI layers can warn/deprioritize using the exact same detection — see LIKELY_HEVC_PATTERN. */
export function hasLikelyHevcVideo(stream: StremioStream): boolean {
  return LIKELY_HEVC_PATTERN.test(streamText(stream));
}

export interface LanguageOption {
  code: string;
  label: string;
}

/** Shown in Settings and used to validate a saved preference — order is display order. */
export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "hi", label: "Hindi" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
];

/** Release-title language hints — explicit words (incl. native spellings) and flag emoji, per language code. */
const LANGUAGE_PATTERNS: Record<string, RegExp> = {
  en: /\benglish\b|🇬🇧|🇺🇸|🇦🇺|🇨🇦/u,
  es: /\bspanish\b|\bespa[nñ]ol\b|\bcastellano\b|\blatino\b|🇪🇸|🇲🇽|🇦🇷/iu,
  fr: /\bfrench\b|\bfran[cç]ais\b|\bvostfr\b|\btruefrench\b|\bvff\b/iu,
  de: /\bgerman\b|\bdeutsch\b|🇩🇪/iu,
  it: /\bitalian[o]?\b|\bita\b|🇮🇹/iu,
  pt: /\bportuguese\b|\bportugues\b|\bdublado\b|\blegendado\b|🇵🇹|🇧🇷/iu,
  ru: /\brussian\b|🇷🇺/iu,
  hi: /\bhindi\b|🇮🇳/u,
  ja: /\bjapanese\b|🇯🇵/iu,
  ko: /\bkorean\b|🇰🇷/iu,
  zh: /\bchinese\b|\bmandarin\b|\bcantonese\b|🇨🇳/iu,
};

/** A release bundling multiple language tracks — plausibly includes whichever one the user wants, so treated as a match for any preference. */
const MULTI_LANGUAGE_PATTERN = /\bmulti\b|\bdual[\s.-]?audio\b/i;

function detectStreamLanguages(stream: StremioStream): { codes: string[]; multi: boolean } {
  const text = streamText(stream);
  const codes: string[] = [];
  for (const [code, pattern] of Object.entries(LANGUAGE_PATTERNS)) {
    if (pattern.test(text)) codes.push(code);
  }
  return { codes, multi: MULTI_LANGUAGE_PATTERN.test(text) };
}

/**
 * Whether a stream matches a user's preferred language (Settings ->
 * Playback). A release with no language explicitly mentioned defaults to
 * matching only "en": these release ecosystems only bother tagging
 * language when it's a departure from the assumed-English default, so an
 * untagged release is overwhelmingly English in practice — filtering
 * those out for an English preference would hide almost everything.
 * "any" (the default) never filters at all.
 */
export function matchesPreferredLanguage(stream: StremioStream, preferredLanguage: string): boolean {
  if (preferredLanguage === "any") return true;
  const { codes, multi } = detectStreamLanguages(stream);
  if (multi) return true;
  if (codes.length === 0) return preferredLanguage === "en";
  return codes.includes(preferredLanguage);
}

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
