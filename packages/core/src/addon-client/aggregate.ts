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
 * Container formats genuinely no major browser's native <video> element
 * can parse, in ANY configuration — unlike MKV (see isMkvContainer,
 * below), there's no browser-specific exception for any of these; every
 * one of Chrome/Edge/Safari/Firefox refuses all of them outright,
 * regardless of the codecs inside. Real report this addresses:
 * "resolving works now, but the player opens to a black/frozen screen
 * and pause/unpause don't do anything" — after confirming resolve
 * itself succeeds, that's exactly what an unsupported container looks
 * like, not a Skybox bug. mp4/m4v/webm/mov are fine.
 */
const UNPLAYABLE_CONTAINER_EXTENSIONS = new Set(["avi", "wmv", "flv", "ts", "m2ts", "vob", "rm", "rmvb", "divx"]);

/** Checked against the REAL resolved filename (not a title guess) — reliable, since this is the file that's actually about to be handed to <video>. */
export function isLikelyUnplayableContainer(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? UNPLAYABLE_CONTAINER_EXTENSIONS.has(ext) : false;
}

/**
 * Same container extensions as above, but as a pre-resolve heuristic
 * against the release title/name text rather than the real resolved
 * filename — many Stremio stream titles are literally (or end with) the
 * actual torrent filename, extension included. Used only as a ranking
 * signal (prefer a source that looks natively container-compatible from
 * the start): these ARE fixable via remux (stream-proxy's remux path
 * outputs MP4 regardless of the input container), so this is only a
 * "nicer to have, avoids an ffmpeg round-trip" preference, never a
 * reason to hide a source outright.
 */
const LIKELY_UNPLAYABLE_CONTAINER_PATTERN = new RegExp(
  `\\.(?:${Array.from(UNPLAYABLE_CONTAINER_EXTENSIONS).join("|")})\\b`,
  "i",
);

/** Exported so UI layers can rank/display using the exact same pre-resolve heuristic — see LIKELY_UNPLAYABLE_CONTAINER_PATTERN. */
export function hasLikelyUnplayableContainerHint(stream: StremioStream): boolean {
  return LIKELY_UNPLAYABLE_CONTAINER_PATTERN.test(streamText(stream));
}

/**
 * MKV was originally lumped in with the genuinely-universal-never-works
 * containers above — wrong, corrected after a user pushed back with real
 * evidence. Firefox added native Matroska container demuxing, on by
 * default since Firefox 145 (Mozilla's own bug tracker, meta-bug
 * 1422891), for the same codecs it already supports in other containers
 * (H.264, HEVC, VP8/9, AV1 video; AAC, Opus, Vorbis audio) — this is
 * genuinely the SAME class of question as HEVC support (see
 * hasLikelyHevcVideo just below): per-viewer-browser, not a fixed rule.
 * Chrome/Edge/Safari still have no general MKV support at all (Chrome
 * only demuxes the WebM *profile* of Matroska, not arbitrary MKV), so
 * this stays a real concern for those — just not for every browser.
 */
export function isMkvContainer(filename: string): boolean {
  return filename.split(".").pop()?.toLowerCase() === "mkv";
}

const LIKELY_MKV_CONTAINER_PATTERN = /\.mkv\b/i;

/** Pre-resolve title-text heuristic sibling to isMkvContainer, same reasoning as hasLikelyUnplayableContainerHint above. */
export function hasLikelyMkvContainerHint(stream: StremioStream): boolean {
  return LIKELY_MKV_CONTAINER_PATTERN.test(streamText(stream));
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
 * every source tried regardless of container. `h[\s.]?265` (not just
 * `h\.?265`) after a real release seen in the wild tagged
 * "H 265-GROUP" — a space, not a dot or nothing, between "H" and "265".
 */
const LIKELY_HEVC_PATTERN = /\b(?:x265|h[\s.]?265|hevc|hvc1|hev1)\b/i;

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
 * Real report: a release tagged both 🇬🇧 and 🇷🇺 (English AND Russian
 * audio both present) played in Russian despite an English preference —
 * containing the preferred language isn't the same as it being the
 * DEFAULT track a plain <video> (or a naive first-audio-stream remux)
 * actually plays. Exported so resolve-stream can decide whether it's
 * worth probing the real file for per-track language metadata and
 * selecting the right one explicitly (see stream-proxy.ts) — only
 * meaningful when there's more than one language to begin with,
 * multi/dual-audio tagged or two-plus distinct languages detected.
 */
export function hasMultipleLanguageTracksHint(stream: StremioStream): boolean {
  const { codes, multi } = detectStreamLanguages(stream);
  return multi || codes.length >= 2;
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
 * Rank streams: cached (RD+/PM+/... labeled) first, then by resolution
 * hint (2160p > 1080p > 720p > other), then browser-playable audio ahead
 * of DTS/AC3/TrueHD/Atmos as a last-resort tiebreaker, stable otherwise
 * (original — i.e. per-addon arrival — order is preserved for ties).
 * Array.prototype.sort is stable per spec, but we also carry the original
 * index as an explicit tiebreaker so ranking behavior doesn't depend on
 * engine internals.
 *
 * Audio compatibility briefly outranked cached/resolution entirely (see
 * git history) — reverted per real usage feedback once stream-proxy's
 * audio remux (DTS/AC3/etc -> AAC, server-side, transparent) actually
 * started working reliably: releases needing remux turned out to be the
 * HIGHER-quality, more reliable ones for a lot of titles (real-world
 * report: "a lot of the audio converted ones are now seemingly the most
 * reliable... but we deprioritized them"), so burying them behind
 * possibly-lower-quality natively-compatible releases was actively
 * making the ranking worse, not better, now that the thing it was
 * protecting against (silent/broken audio) is a solved problem. Back to
 * only breaking a tie between two otherwise-equal candidates, same as
 * before audio compatibility was ever a fixable concern.
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
