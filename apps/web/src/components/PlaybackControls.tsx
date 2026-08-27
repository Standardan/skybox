"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { racePool } from "@skybox/core/shared";
import {
  isCached,
  detectResolution,
  hasLikelyIncompatibleAudio,
  hasLikelyHevcVideo,
  hasLikelyUnplayableContainerHint,
  hasLikelyMkvContainerHint,
  isLikelyUnplayableContainer,
  isMkvContainer,
  matchesPreferredLanguage,
  LANGUAGE_OPTIONS,
} from "@skybox/core/addon-client";
import type { LastWorkingSource, MediaType, PlaybackPrefs, StremioStream } from "@skybox/core/shared";
import { Player, type PlayerSource } from "@/components/Player";
import styles from "./PlaybackControls.module.css";

interface PlaybackPrefsResult {
  streams: StremioStream[];
  /** True only when a language filter was requested but matched nothing at all — the filter was skipped rather than leaving a dead "no sources" end for an otherwise-available title. */
  languageFilterFellBack: boolean;
  /** True only when every source was flagged incompatible (audio codec, or HEVC on a browser that can't decode it) — filtering was skipped rather than leaving a dead "no sources" end when nothing better exists for this title. */
  compatibilityFilterFellBack: boolean;
}

/**
 * Real report this fixes: 4K/HDR/Dolby-Vision releases (near-universally
 * HEVC/x265, since H.264 doesn't carry that metadata well) resolving fine
 * but showing a black screen with a MediaError METADATA code — Firefox
 * ships no HEVC decoder at all outside a narrow set of platform codec
 * packs, unlike Chrome/Edge/Safari which mostly do. This is a genuine
 * per-viewer browser fact (not a fixed rule like the audio-codec check),
 * so it's checked once via the real `canPlayType` API rather than baked
 * into the framework-free ranking in @skybox/core. Memoized at module
 * scope — the answer can't change within a single page load.
 */
let hevcSupportCache: boolean | null = null;
function canBrowserPlayHevc(): boolean {
  if (hevcSupportCache !== null) return hevcSupportCache;
  if (typeof document === "undefined") return true;
  const video = document.createElement("video");
  const support =
    video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.90"') ||
    video.canPlayType('video/mp4; codecs="hev1.1.6.L93.90"');
  // Real report: a genuinely HEVC-encoded 4K release played through to a
  // silent black screen on Firefox, with none of the HEVC warning banners
  // below ever showing — meaning canPlayType had reported HEVC as
  // playable. Real Firefox apparently answers "maybe" for the HEVC codec
  // string it recognizes by name, without confirming an actual decoder
  // (typically a separate, not-always-installed platform codec pack) is
  // present — "maybe" is spec'd as the API's lowest-confidence answer,
  // and evidently not reliable enough to act on here. Only "probably"
  // (the API's high-confidence answer) is trusted now — asymmetric
  // on purpose: under-trusting just means an unnecessary "every source
  // is HEVC" fallback/banner for a browser that could actually play it,
  // over-trusting means exactly the silent black screen this fixes.
  hevcSupportCache = support === "probably";
  return hevcSupportCache;
}

/**
 * Real research finding, after a user correctly pushed back on an
 * earlier "no browser plays MKV" assumption: Firefox added native
 * Matroska container support, on by default since Firefox 145 (Mozilla
 * bug tracker meta-bug 1422891) — for the same codecs it already
 * supports elsewhere (H.264, HEVC, VP8/9, AV1 video; AAC, Opus, Vorbis
 * audio). Chrome/Edge/Safari still have no general MKV support at all.
 * Exactly the same class of question as HEVC above: per-viewer-browser,
 * checked via the real canPlayType() API rather than assumed. `false`
 * on the SSR guard (unlike HEVC's `true`) is the deliberately safer
 * default here — under-detecting MKV support just means an unnecessary
 * remux round-trip, while over-detecting it would mean skipping a
 * remux a source actually needed and landing back on a black screen.
 *
 * Only "probably" is trusted, not "maybe" — same fix and same real
 * report as canBrowserPlayHevc() above (a genuinely HEVC-in-MKV 4K
 * release black-screened on Firefox with canPlayType having answered
 * "maybe" for the HEVC codec string). "maybe" is documented as this
 * API's lowest-confidence answer; evidently not reliable enough here.
 */
let mkvSupportCache: boolean | null = null;
function canBrowserPlayMkv(): boolean {
  if (mkvSupportCache !== null) return mkvSupportCache;
  if (typeof document === "undefined") return false;
  const video = document.createElement("video");
  const support = video.canPlayType('video/x-matroska; codecs="avc1.42E01E, mp4a.40.2"');
  mkvSupportCache = support === "probably";
  return mkvSupportCache;
}

/**
 * `aggregateStreams` already ranks cached-first-then-resolution by default
 * (matching the `preferCached: true` default). This re-sorts using the same
 * detection when the user's actual saved preference differs — resolution
 * priority first when cache isn't preferred, and a specific resolution
 * pinned to the front when one is chosen. Stable otherwise (preserves
 * `aggregateStreams`' own tie-break order). A preferred language, if set,
 * then actually filters (not just re-sorts) the list — but never down to
 * zero: if nothing matches, the filter is skipped for this title rather
 * than silently hiding every source.
 */
function applyPlaybackPrefs(streams: StremioStream[], prefs: PlaybackPrefs): PlaybackPrefsResult {
  const hevcUnplayable = !canBrowserPlayHevc();
  const mkvUnplayable = !canBrowserPlayMkv();
  const sorted = streams
    .map((stream, index) => ({ stream, index }))
    .sort((a, b) => {
      // Checked first, ahead of every preference below — and only when
      // this browser genuinely can't decode HEVC at all. Real report:
      // with most 4K/HDR releases HEVC-encoded and this only a tertiary
      // tiebreaker, "Play" (and manually browsing "All sources") kept
      // landing on releases that were never going to work, making the
      // small pool of actually-compatible options hard to find. A broken
      // 4K/preferred-resolution stream is worth strictly less than a
      // working one at a worse resolution, so this now outranks both the
      // resolution and cached preferences instead of only breaking ties
      // between two otherwise-equal candidates.
      if (hevcUnplayable) {
        const aHevc = Number(hasLikelyHevcVideo(a.stream));
        const bHevc = Number(hasLikelyHevcVideo(b.stream));
        if (aHevc !== bHevc) return aHevc - bHevc;
      }
      if (prefs.preferredResolution !== "any") {
        const aMatch = Number(detectResolution(a.stream) !== prefs.preferredResolution);
        const bMatch = Number(detectResolution(b.stream) !== prefs.preferredResolution);
        if (aMatch !== bMatch) return aMatch - bMatch;
      }
      if (!prefs.preferCached) {
        const aCached = Number(!isCached(a.stream));
        const bCached = Number(!isCached(b.stream));
        if (aCached !== bCached) return bCached - aCached; // inverted: uncached first
      }
      // Audio codec and container used to outrank resolution/cache
      // preference entirely — reverted per real usage feedback once
      // stream-proxy's remux (audio -> AAC, container -> MP4, transparent
      // and server-side) started working reliably: releases needing
      // remux turned out to be the higher-quality, more reliable ones for
      // a lot of titles, so burying them behind lower-quality natively-
      // compatible releases was making things worse, not better. Back to
      // only breaking a tie between two otherwise-equal candidates, same
      // as aggregateStreams' own server-side ranking (see its doc
      // comment). HEVC above stays a hard preference — that's still a
      // genuinely unfixable limitation on this browser, unlike these two.
      const aAudio = Number(hasLikelyIncompatibleAudio(a.stream));
      const bAudio = Number(hasLikelyIncompatibleAudio(b.stream));
      if (aAudio !== bAudio) return aAudio - bAudio;
      const aContainer = Number(hasLikelyUnplayableContainerHint(a.stream));
      const bContainer = Number(hasLikelyUnplayableContainerHint(b.stream));
      if (aContainer !== bContainer) return aContainer - bContainer;
      // Same tiebreaker treatment as the audio/container checks above, not
      // a hard filter like HEVC — an MKV this browser can't play natively
      // still plays fine once resolve-stream remuxes it to MP4 server-side
      // (see stream-proxy.ts), so it's only ranked behind sources that
      // don't need that round-trip, never hidden.
      if (mkvUnplayable) {
        const aMkv = Number(hasLikelyMkvContainerHint(a.stream));
        const bMkv = Number(hasLikelyMkvContainerHint(b.stream));
        if (aMkv !== bMkv) return aMkv - bMkv;
      }
      return a.index - b.index;
    })
    .map(({ stream }) => stream);

  // "Fully hide" per a real complaint, not just deprioritize (the earlier
  // fix): with so few releases actually compatible for a lot of titles,
  // scrolling past several dead entries in "All sources" just to find the
  // couple that might work was its own real annoyance. Same never-filter-
  // to-zero fallback as the language filter below — showing every
  // (labeled) source beats a false "no sources found" when nothing
  // compatible exists for this title at all.
  //
  // Audio-incompatible sources are NOT filtered out here (unlike HEVC) —
  // resolve-stream now transparently remuxes DTS/AC3/TrueHD/Atmos audio
  // to AAC server-side (see stream-proxy.ts), so these actually do play;
  // they're just ranked behind natively-compatible sources above, since
  // native playback is still cheaper (no ffmpeg process, no startup
  // delay, and remuxed sources don't support seeking — see stream-proxy's
  // doc comment). HEVC video has no such fix on this VPS (no GPU, and
  // real-time software HEVC transcoding isn't realistic in this app's
  // deployment context), so that's still a real, unfixable incompatibility
  // and stays filtered when this browser can't decode it.
  const compatible = sorted.filter((stream) => {
    if (hevcUnplayable && hasLikelyHevcVideo(stream)) return false;
    return true;
  });
  const withCompatibility = compatible.length > 0 ? compatible : sorted;
  const compatibilityFilterFellBack = compatible.length === 0 && sorted.length > 0;

  if (prefs.preferredLanguage === "any") {
    return { streams: withCompatibility, languageFilterFellBack: false, compatibilityFilterFellBack };
  }
  const filtered = withCompatibility.filter((stream) => matchesPreferredLanguage(stream, prefs.preferredLanguage));
  if (filtered.length === 0 && withCompatibility.length > 0) {
    return { streams: withCompatibility, languageFilterFellBack: true, compatibilityFilterFellBack };
  }
  return { streams: filtered, languageFilterFellBack: false, compatibilityFilterFellBack };
}

/** Same identity a stream is deduped/persisted by elsewhere (infoHash+fileIdx, or url) — matching aggregateStreams' own dedupeKey logic. */
function sourceIdentity(stream: Pick<StremioStream, "url" | "infoHash" | "fileIdx">): string | undefined {
  if (stream.url) return `url:${stream.url}`;
  if (stream.infoHash) return `hash:${stream.infoHash.toLowerCase()}:${stream.fileIdx ?? ""}`;
  return undefined;
}

/**
 * Real feature request: "if the movie is working for me right now...
 * tomorrow I want to watch the same movie, it should first test the one
 * I was watching successfully." Moves the confirmed-working source (see
 * Player.tsx's onConfirmedWorking) to the very front — above every other
 * ranking signal, since a source that's ACTUALLY been confirmed to play
 * is strictly stronger evidence than any title-text heuristic. No-op
 * (including when it simply isn't present in `streams` at all — e.g. the
 * addon's catalog changed, or it got filtered by a since-changed
 * language/compatibility preference) rather than trying to resurrect it
 * from a different, unfiltered list.
 */
function prioritizeLastWorkingSource(
  streams: StremioStream[],
  lastWorkingSource: LastWorkingSource | undefined,
  currentVideoId: string,
): StremioStream[] {
  if (!lastWorkingSource || lastWorkingSource.videoId !== currentVideoId) return streams;
  const targetIdentity = sourceIdentity(lastWorkingSource);
  if (!targetIdentity) return streams;
  const matchIndex = streams.findIndex((stream) => sourceIdentity(stream) === targetIdentity);
  if (matchIndex <= 0) return streams; // not found, or already first — nothing to do
  const match = streams[matchIndex]!;
  return [match, ...streams.slice(0, matchIndex), ...streams.slice(matchIndex + 1)];
}

function reportProgress(metaId: string, type: MediaType, videoId: string, positionSec: number, durationSec: number) {
  // Best-effort — a failed progress ping shouldn't interrupt playback, and
  // there's nothing useful to show the user for it.
  void fetch("/api/library/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metaId, type, videoId, positionSec, durationSec }),
    keepalive: true,
  }).catch(() => {});
}

/**
 * Real feature request: "so much time between episodes that I have to sit
 * here and wait for one [source] to work." A background prefetch (see
 * resolveNextEpisodePrefetch below) resolves the next episode's source
 * WHILE the current one is still playing, then stashes the result here so
 * the next episode's PlaybackControls instance (a fresh remount — episode
 * navigation is a full page nav, not a prop update) can pick it up on
 * mount instead of re-resolving from scratch.
 *
 * sessionStorage, not localStorage: the cached value is a live, single-
 * use debrid-CDN URL (same reason resolve-stream/route.ts's own
 * redactedUrlForLogging goes out of its way to never log one verbatim) —
 * tab-scoped storage that self-clears on tab close is the safer fit than
 * something that would persist across the whole browser profile.
 * LastWorkingSource (packages/core/src/shared/types.ts) is deliberately
 * NOT reused for this: its own doc comment states the resolved URL "is
 * single-use/expires," which is exactly why that type only ever persists
 * source IDENTITY, never a resolved URL — reusing it here would violate
 * that invariant.
 */
const PREFETCH_FRESHNESS_MS = 5 * 60 * 1000;

interface PrefetchedNextEpisode {
  url: string;
  filename: string | null;
  remuxed: boolean;
  resolvedAt: number;
  /** The winning candidate's identity (see sourceIdentity() below) — lets the next episode's fresh streams array find the matching row for playingIndex, without needing to persist the resolved URL's own identity (it has none independent of the original stream). */
  sourceIdentity?: string;
}

function prefetchCacheKey(metaId: string, videoId: string): string {
  return `skybox:prefetch:${metaId}:${videoId}`;
}

function writePrefetchCache(
  metaId: string,
  videoId: string,
  entry: Omit<PrefetchedNextEpisode, "resolvedAt">,
): void {
  try {
    sessionStorage.setItem(
      prefetchCacheKey(metaId, videoId),
      JSON.stringify({ ...entry, resolvedAt: Date.now() } satisfies PrefetchedNextEpisode),
    );
  } catch {
    // Private browsing / storage disabled — prefetch just silently doesn't help this time.
  }
}

/**
 * One-shot: consumes (reads + clears) a fresh prefetch entry, or returns
 * null on a miss/stale-entry/storage-unavailable. Callers must always
 * have a normal-resolve fallback for the null case — this is a best-
 * effort speed-up, never the only path to playback.
 */
function consumePrefetchCache(metaId: string, videoId: string): PrefetchedNextEpisode | null {
  try {
    const key = prefetchCacheKey(metaId, videoId);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    sessionStorage.removeItem(key);
    const entry = JSON.parse(raw) as PrefetchedNextEpisode;
    if (Date.now() - entry.resolvedAt > PREFETCH_FRESHNESS_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

interface ResolveResponse {
  ok: boolean;
  playableUrl?: string;
  filename?: string;
  /** True when resolve-stream routed this through stream-proxy's ffmpeg remux — the filename/title-based warning banners below describe a problem that's already been fixed server-side when this is true, so they're suppressed. */
  remuxed?: boolean;
  message?: string;
  /** false when this failure is connection-level (never reached the debrid provider at all) rather than specific to this source — every other source hits the same host and would fail identically, so the caller stops instead of grinding through the rest of the list. */
  retryable?: boolean;
}

/**
 * Real report: "it cycled until it got to one it was stuck resolving on
 * and couldn't get past it." TorBox (and debrid providers generally) can
 * poll internally for a couple minutes waiting for a torrent to finish
 * caching before giving up (packages/core/src/debrid/torbox.ts's
 * waitForDownload — up to 60 attempts × 3s, a genuinely reasonable
 * server-side patience for a slow-but-real download) — but the auto-
 * retry loop below awaits each source SEQUENTIALLY, so one source that
 * never finishes caching (few/no seeders) blocks the entire loop for
 * however long the server is willing to wait, with nothing on the
 * client side ever giving up on its own. `signal` (aborted when the
 * caller moves to a genuinely different playIndex call, e.g. the user
 * picks another source manually) doesn't help here — that's a later
 * action that can never happen while THIS same await is what's stuck.
 * RESOLVE_TIMEOUT_MS bounds a single source's resolve attempt
 * independently of both the server's own patience and any outer signal,
 * so the loop can always move on to the next candidate within a bounded
 * time — most legitimate resolves finish in well under this regardless.
 */
const RESOLVE_TIMEOUT_MS = 45_000;

/**
 * How many ranked candidates playIndex races at once via racePool, instead
 * of trying them strictly one at a time. Real report this fixes: waiting
 * "several minutes" for a working source when the first few ranked ones
 * were each slow to fail. Kept deliberately small (not the whole list at
 * once) — nothing in this app's debrid layer rate-limits requests today
 * except this very concurrency cap (see resolve-stream/route.ts's
 * `retryable` doc comment for the real rate-limit incident that shaped
 * that), so this is a reasoned starting point to tune from real usage,
 * not a measured optimum.
 */
const RESOLVE_POOL_CONCURRENCY = 2;

/**
 * How close to the end of the CURRENT episode (in seconds remaining) the
 * background next-episode prefetch waits before actually resolving a
 * source (see resolveNextEpisodePrefetch). The resolved link is real,
 * single-use, and expires — resolving too early risks it being dead by
 * the time the user actually reaches the next episode; too late and it
 * isn't ready when they click.
 *
 * Real report this was shrunk for (from an original 180s): "I was
 * successfully watching this episode... and then all of a sudden I got
 * the testing sources screen and it put the episode back to the
 * beginning." The server log showed the CURRENTLY-PLAYING episode's
 * source getting re-resolved and re-attached mid-session, right around
 * when the next-episode prefetch's real debrid-provider resolve calls
 * were also firing in the background — a 3-minute overlap window is a
 * long time for that background activity to potentially compete with or
 * disrupt an actively-streaming connection to the same provider. 30s
 * keeps the same two benefits (a head start before the user clicks Next,
 * and a fresher link than resolving too early) while drastically
 * shrinking that overlap window — normally more than enough lead time,
 * since a working resolve typically completes in a few seconds. The
 * exact debrid link TTL still isn't documented anywhere in this
 * codebase, so this remains a reasoned default, not a measured number.
 */
const NEAR_END_THRESHOLD_SEC = 30;

/**
 * Real regression report right after shipping the "Testing sources…"
 * screen: sources would resolve fine but playback would just never start
 * — "I can never get a show to start playing... anything." Root cause:
 * hiding the player until onPlaybackReady (the native `playing` event)
 * fires assumed that event always eventually happens for a loaded video,
 * but browsers commonly block autoplay-WITH-SOUND under conditions that
 * DON'T throw a catchable error and DON'T fire `playing` either — the
 * video just sits loaded, paused, and silent, forever, waiting for a
 * manual click <video>'s own onClick={togglePlay} already supports. That
 * click was previously always reachable (the player was visible even
 * while paused); hiding it behind an opaque loading screen turned an
 * existing "click to start" fallback into a dead end with no way to
 * even discover it. This is a deliberate fail-OPEN safety net, not a fix
 * for a specific bug: if onPlaybackReady hasn't fired this long after a
 * source resolved, reveal the real player anyway — worst case a viewer
 * sees a paused frame and clicks it themselves, exactly like before this
 * feature existed; best case this rarely fires at all, since a genuinely
 * working, unblocked source confirms within a second or two.
 *
 * Two different values, not one flat number — real feedback: "we're
 * getting them from debrid services, and that should already be cached...
 * loading basically instantly, so I don't understand why this is such a
 * long process." A native (non-remuxed) source genuinely should confirm
 * in a second or two once resolved, so it gets a short fallback — if it's
 * not ready by then, something's actually stuck and revealing sooner is
 * more helpful, not less. A source stream-proxy is remuxing (see
 * playingRemuxed below) is a different story: it's routed through a
 * server-side ffmpeg process that needs to actually start up and begin
 * transcoding before the first bytes come back at all — stream-proxy's
 * own REMUX_STARTUP_TIMEOUT_MS gives that up to 15s of real, unavoidable
 * startup latency, so a 6s client-side fallback would reveal (or worse,
 * feel "glitchy" revealing) a remux that's still legitimately starting
 * up, not actually broken.
 */
const SOURCE_READY_FALLBACK_MS = 3_000;
const SOURCE_READY_FALLBACK_MS_REMUXED = 16_000;

async function resolveStream(stream: StremioStream, signal: AbortSignal): Promise<ResolveResponse> {
  const res = await fetch("/api/resolve-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      infoHash: stream.infoHash,
      fileIdx: stream.fileIdx,
      url: stream.url,
      // Title/name only — used server-side purely to decide whether this
      // release's audio needs remuxing (hasLikelyIncompatibleAudio), same
      // detection this file already runs client-side for ranking/display.
      title: stream.title,
      name: stream.name,
      // Real per-viewer fact (Firefox 145+ decodes MKV natively, other
      // browsers don't) — lets resolve-stream skip an unnecessary remux
      // round-trip when this browser can already play the file as-is.
      mkvSupported: canBrowserPlayMkv(),
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(RESOLVE_TIMEOUT_MS)]),
  });
  return (await res.json()) as ResolveResponse;
}

function streamLabel(stream: StremioStream): string {
  return stream.title || stream.name || "Unnamed source";
}

/**
 * Owns stream selection + resolve + playback for a title/episode (B4-B6).
 * Renders the primary one-click "Play" action (B5) plus an expandable "All
 * sources" list, and resolves the chosen stream through the connected debrid provider before
 * handing a playable URL to <Player/>. Debrid-resolved links are direct
 * files, so every resolved source plays with format: "native" per
 * Player.tsx's own doc comment (docs/07-DECISIONS.md D-015).
 */
export function PlaybackControls({
  streams: rawStreams,
  hasAddons,
  title,
  poster,
  metaId,
  mediaType,
  videoId,
  playbackPrefs,
  resumePositionSec,
  expectedRuntimeMinutes,
  lastWorkingSource,
  nextVideoId,
  nextEpisodeLabel,
  autoPlayOnMount,
}: {
  streams: StremioStream[];
  hasAddons: boolean;
  title: string;
  poster?: string;
  /** Show/movie-level id — Continue Watching tracks progress at this level, not per-episode. */
  metaId: string;
  mediaType: MediaType;
  /** The specific episode/movie actually being resolved and played. */
  videoId: string;
  playbackPrefs: PlaybackPrefs;
  /** Where to resume, from this instance's saved progress. Omit/0 to start at the beginning. */
  resumePositionSec?: number;
  /** Cinemeta's stated runtime in minutes, if known — used to catch a resolved source that's actually just a trailer (see Player.tsx's onLikelyTrailer). */
  expectedRuntimeMinutes?: number;
  /** The source that last actually played for this videoId, if any — tried first (see prioritizeLastWorkingSource). */
  lastWorkingSource?: LastWorkingSource;
  /** The next episode's videoId, if this is a series and one exists — drives background prefetch + the "Next Episode" prompt. Undefined for a movie or the last episode. */
  nextVideoId?: string;
  nextEpisodeLabel?: string;
  /** True when this page was reached via a "Next Episode" click (see the ?autoplay=1 handoff) — triggers an immediate play attempt on mount, using a fresh background-prefetched source if one's ready. */
  autoPlayOnMount?: boolean;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // A Set, not a single index — playIndex now races several candidates
  // concurrently (see racePool) rather than trying them strictly one at a
  // time, so more than one row can legitimately be "Resolving…" at once.
  const [resolvingIndices, setResolvingIndices] = useState<ReadonlySet<number>>(new Set());
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [playerSource, setPlayerSource] = useState<PlayerSource | null>(null);
  // Real feature request: cycling through bad candidates used to mean
  // briefly flashing a half-broken <video> (black/frozen frame, player
  // chrome visible) for each one before auto-retry moved on — confusing
  // and janky. False from the moment ANY new attempt starts (a resolve
  // begins, or a resolved source is handed to <Player>) until Player's
  // onPlaybackReady confirms real frames are actually rendering — a
  // resolve succeeding is NOT enough on its own, since that's exactly
  // what "resolved fine, black screen anyway" bugs have looked like.
  // While false, a clean "Testing sources…" screen covers the player
  // area instead of exposing the attempt in progress.
  const [sourceReady, setSourceReady] = useState(false);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  // The REAL resolved filename (not a title guess) — lets the container
  // warning below be reliable instead of a heuristic, since this is the
  // exact file about to be handed to <video>.
  const [playingFilename, setPlayingFilename] = useState<string | null>(null);
  // True when resolve-stream remuxed this source server-side — the
  // filename-based container warning and title-based audio warning below
  // both describe a problem that's already been fixed when this is true,
  // so both get suppressed rather than showing a scary banner for
  // something that's actually working now.
  const [playingRemuxed, setPlayingRemuxed] = useState(false);
  // True once at least one source has been auto-skipped for confirmed
  // silent audio (see handleNoAudioDetected below) — persists across the
  // rest of this session so the user still sees why a source got skipped,
  // even though it happens silently otherwise (same as a genuine
  // playback failure). Real report: a silent source used to just show a
  // warning banner while continuing to play — "you should never play
  // this... this is horrible." A video with no audio isn't a lesser
  // version of working, it's exactly as broken as a real playback error,
  // and now treated as one.
  const [noAudioSkipped, setNoAudioSkipped] = useState(false);
  // True once at least one source has been auto-skipped for looking like
  // a trailer (see handleLikelyTrailer below) — persists across the rest
  // of this session so the user still sees why a source got skipped,
  // even though it happens silently otherwise (same as a genuine
  // playback failure).
  const [trailerSkipped, setTrailerSkipped] = useState(false);
  // Owns the currently-running auto-retry loop (if any) so it can actually
  // be cancelled — a stuck/slow network request (a real report: ECONNRESET
  // hanging for a while before failing) used to keep the loop running with
  // no way to stop it short of navigating away entirely, since closing the
  // sources panel only hid it visually and the loop would just force it
  // back open on its next failure regardless.
  const abortRef = useRef<AbortController | null>(null);
  // Real report: an auto-retry to a new source MID-SESSION (e.g. a real
  // playback error a while into watching, not the initial resolve) was
  // seeking the newly-attached source back to `resumePositionSec` — a
  // page-load-time prop from the LAST time this title was opened, not
  // wherever the viewer actually was when the retry happened. Updated on
  // every onProgress tick so a retry always resumes from the most
  // recently known live position instead; falls back to the real
  // resumePositionSec prop only for the very first attach, before any
  // progress has been reported yet.
  const lastKnownPositionRef = useRef<number | undefined>(resumePositionSec);
  // Separate from abortRef: the background next-episode prefetch (see
  // resolveNextEpisodePrefetch) is a best-effort task independent of the
  // CURRENT episode's own playback/retry lifecycle — it shouldn't be
  // cancelled by e.g. picking a different source for this episode, only
  // by actually leaving this page.
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const nextEpisodeCandidatesRef = useRef<Promise<StremioStream[]> | null>(null);
  const hasTriggeredPrefetchResolve = useRef(false);
  const [showNextEpisodePrompt, setShowNextEpisodePrompt] = useState(false);
  const router = useRouter();

  const { streams, languageFilterFellBack, compatibilityFilterFellBack } = useMemo(() => {
    const result = applyPlaybackPrefs(rawStreams, playbackPrefs);
    return { ...result, streams: prioritizeLastWorkingSource(result.streams, lastWorkingSource, videoId) };
  }, [rawStreams, playbackPrefs, lastWorkingSource, videoId]);
  // Computed once per mount (the answer can't change mid-session) — gates
  // the HEVC warning below so a viewer whose browser actually plays HEVC
  // fine (Chrome/Edge/Safari, mostly) never sees it.
  const hevcUnplayable = useMemo(() => !canBrowserPlayHevc(), []);
  // Same reasoning as hevcUnplayable above — gates the MKV warning banner
  // so a Firefox 145+ viewer who can actually play MKV natively never sees it.
  const mkvUnplayable = useMemo(() => !canBrowserPlayMkv(), []);

  /**
   * A single source's *resolve* step (not playback) failing — e.g. a debrid
   * provider refusing one specific release for a legal/DMCA reason, or a
   * dead/expired link — used to just stop and show an error, leaving the
   * user to dig through "All sources" themselves for a working one. Most
   * titles have several sources unaffected by whatever took this one out,
   * so this now keeps trying forward automatically, the same way a
   * *playback* failure already does via handleSourceFailed below, and only
   * surfaces an error once every remaining source has also failed.
   *
   * Stops launching NEW resolves (in-flight ones are left to finish — one
   * can still win) instead of exhausting the whole list when the server
   * marks a failure `retryable: false` (a connection-level failure that
   * never reached the debrid provider at all, e.g. a reset connection, or
   * an account-wide rate limit) — every other source resolves through
   * that exact same provider host and would fail identically, so
   * grinding through the rest is both pointless and, worse, the actual
   * cause of a real report: it read as "stuck trying to resolve every
   * source" with no way to tell it wasn't.
   *
   * Real report this races instead of walking sequentially for: waiting
   * "several minutes" for a working source, because each candidate was
   * tried fully (up to RESOLVE_TIMEOUT_MS) before the next one even
   * started. RESOLVE_POOL_CONCURRENCY candidates now race at once via
   * racePool — first success wins, siblings are cancelled. See
   * resolve-pool.ts's own doc comment for why this still respects
   * `retryable: false` as a hard stop on NEW dispatches, not just noise.
   */
  const playIndex = useCallback(
    async (startIndex: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setResolveError(null);
      setSourceReady(false);
      const candidates = streams.slice(startIndex);
      const { winner, lastFailure } = await racePool<StremioStream, ResolveResponse>({
        candidates,
        concurrency: RESOLVE_POOL_CONCURRENCY,
        signal: controller.signal,
        resolveOne: async (stream, _i, signal) => {
          try {
            return await resolveStream(stream, signal);
          } catch {
            // A thrown/aborted fetch is treated the same as today's
            // sequential loop treated it: retryable, not a hard stop —
            // only an explicit `retryable: false` from the server halts
            // new dispatches.
            return { ok: false, message: "Failed to resolve this source. Check your connection and try again." };
          }
        },
        isSuccess: (r) => r.ok && !!r.playableUrl,
        isRetryable: (r) => r.retryable !== false,
        onAttemptStart: (i) => {
          const index = startIndex + i;
          setResolvingIndices((prev) => new Set(prev).add(index));
        },
        onAttemptSettled: (i, result) => {
          const index = startIndex + i;
          setResolvingIndices((prev) => {
            const next = new Set(prev);
            next.delete(index);
            return next;
          });
          if (!result.ok) setSourcesOpen(true);
        },
      });

      if (controller.signal.aborted) return;
      if (winner) {
        const index = startIndex + winner.index;
        const result = winner.result;
        setPlayerSource({ url: result.playableUrl!, format: "native" });
        setPlayingIndex(index);
        setPlayingFilename(result.filename ?? null);
        setPlayingRemuxed(result.remuxed ?? false);
        setResolvingIndices(new Set());
        return;
      }
      setResolvingIndices(new Set());
      setResolveError(lastFailure?.message ?? "Failed to resolve this source.");
      setSourcesOpen(true);
    },
    [streams],
  );

  /** Cancels any in-flight resolve/retry pool immediately (aborts the network requests too, not just future attempts) and closes the panel. */
  const stopResolving = useCallback(() => {
    abortRef.current?.abort();
    setResolvingIndices(new Set());
    setResolveError(null);
    setSourcesOpen(false);
    // A resolved-but-not-yet-confirmed-playing source (still behind the
    // "Testing sources…" screen — see sourceReady) is also an in-progress
    // attempt as far as "Stop" is concerned, not something already handed
    // to the user. A genuinely confirmed, currently-playing source is left
    // alone — this only ever cancels the testing/waiting phase.
    if (!sourceReady) setPlayerSource(null);
  }, [sourceReady]);

  // No unmount cleanup existed before this — a stuck/slow resolve just
  // kept running invisibly. More important now that a pool run can have
  // RESOLVE_POOL_CONCURRENCY concurrent fetches in flight, not just one.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      prefetchAbortRef.current?.abort();
    };
  }, []);

  // See SOURCE_READY_FALLBACK_MS's doc comment — reveals the real player
  // even without onPlaybackReady confirming, so a viewer is never stuck
  // behind an opaque "Testing sources…" screen with no way to reach the
  // native play control underneath. Cleared/re-armed whenever playerSource
  // or sourceReady changes, so a source that DOES confirm quickly never
  // triggers this at all.
  useEffect(() => {
    if (!playerSource || sourceReady) return;
    const fallbackMs = playingRemuxed ? SOURCE_READY_FALLBACK_MS_REMUXED : SOURCE_READY_FALLBACK_MS;
    const timer = setTimeout(() => setSourceReady(true), fallbackMs);
    return () => clearTimeout(timer);
  }, [playerSource, sourceReady, playingRemuxed]);

  const handleSourceFailed = useCallback(() => {
    setPlayerSource(null);
    const nextIndex = playingIndex !== null ? playingIndex + 1 : 0;
    if (nextIndex < streams.length) {
      setSourcesOpen(true);
      void playIndex(nextIndex);
    } else {
      setPlayingIndex(null);
      setResolveError("All sources failed to play. Try a different one below.");
      setSourcesOpen(true);
    }
  }, [playIndex, playingIndex, streams.length]);

  /**
   * A source that resolved and "played" but turned out to be a trailer,
   * not the real movie (see Player.tsx's onLikelyTrailer / runtime-check.ts)
   * — treated exactly like a genuine playback failure (auto-advance to
   * the next source), since a trailer is never what the user actually
   * wants. Unlike resolveError (reset at the start of every new attempt
   * in playIndex), this notice deliberately persists so the user still
   * sees WHY it jumped past one, instead of a silent skip that looks
   * like nothing happened.
   */
  const handleLikelyTrailer = useCallback(() => {
    setTrailerSkipped(true);
    handleSourceFailed();
  }, [handleSourceFailed]);

  /**
   * Real report: a source confirmed silent (Player.tsx's
   * onNoAudioTrackDetected — real decode-state check, not a title guess)
   * used to just show a warning banner while continuing to play it —
   * "you should never play this... this is horrible." A video with no
   * audio isn't a degraded-but-acceptable result, it's exactly as broken
   * as a real playback error, so this is now treated like one: same
   * auto-advance-to-the-next-source path as handleLikelyTrailer above.
   */
  const handleNoAudioDetected = useCallback(() => {
    setNoAudioSkipped(true);
    handleSourceFailed();
  }, [handleSourceFailed]);

  /**
   * Phase 1 of the next-episode prefetch — cheap, safe to start early.
   * Just the addon candidate list for nextVideoId, not a resolved/token-
   * bound link yet, so there's no downside to fetching it well before
   * it's actually needed. Cached in a ref so this and
   * resolveNextEpisodePrefetch below (which also calls this, in case a
   * very short episode reaches "near the end" before playback is even
   * confirmed working) share one in-flight request instead of two.
   */
  const prefetchNextEpisodeStreams = useCallback((): Promise<StremioStream[]> => {
    if (!nextEpisodeCandidatesRef.current) {
      nextEpisodeCandidatesRef.current = nextVideoId
        ? fetch(`/api/streams?type=${mediaType}&id=${encodeURIComponent(nextVideoId)}`)
            .then((res) => res.json())
            .then((data: { streams?: StremioStream[] }) => data.streams ?? [])
            .catch(() => [])
        : Promise.resolve([]);
    }
    return nextEpisodeCandidatesRef.current;
  }, [nextVideoId, mediaType]);

  /**
   * Phase 2 — expensive and, unlike the candidate list above, genuinely
   * expiring (see PREFETCH_FRESHNESS_MS's doc comment). Fired once, near
   * the end of the CURRENT episode (see the onProgress wiring below), so
   * the resolved link is as fresh as possible when the user actually
   * reaches the next episode. Races the top 2 ranked candidates through
   * the same racePool live playback uses, then stashes a winner in
   * sessionStorage for the next episode's PlaybackControls instance (a
   * fresh remount — see writePrefetchCache's doc comment) to pick up on
   * mount. Best-effort throughout: any failure here just means the next
   * episode falls back to a normal resolve, same as today.
   */
  const resolveNextEpisodePrefetch = useCallback(async () => {
    if (!nextVideoId) return;
    const candidates = await prefetchNextEpisodeStreams();
    if (candidates.length === 0) return;

    // Real report: "I was successfully watching this episode... and then
    // all of a sudden I got the testing sources screen and it put the
    // episode back to the beginning." Root cause: season-pack releases
    // (very common for TV) share ONE infoHash across every episode,
    // distinguished only by fileIdx — so the next episode's top candidate
    // can be the SAME torrent currently being actively streamed. Resolving
    // it again (add/select-file/unrestrict, the full chain, every single
    // time — see resolveDebridSource) is a second, concurrent debrid
    // operation against a torrent already mid-stream, something this app
    // never did before this prefetch feature existed. Whatever the
    // provider does internally in response (re-verification, a link
    // rotation, anything) is outside this codebase's control, so the safe
    // fix is to never attempt it: skip any candidate sharing the currently
    // -playing source's infoHash entirely, even if that means this
    // specific episode transition doesn't get a prefetch.
    const currentInfoHash = playingIndex !== null ? streams[playingIndex]?.infoHash?.toLowerCase() : undefined;
    const eligible = currentInfoHash
      ? candidates.filter((c) => c.infoHash?.toLowerCase() !== currentInfoHash)
      : candidates;
    if (eligible.length === 0) return;

    prefetchAbortRef.current?.abort();
    const controller = new AbortController();
    prefetchAbortRef.current = controller;

    // concurrency: 1, not RESOLVE_POOL_CONCURRENCY — this runs in the
    // background while the CURRENT episode is still actively streaming
    // from the same debrid account; no user is waiting on it, so there's
    // no reason to add a second concurrent request on top of whatever
    // the live stream is already doing. See NEAR_END_THRESHOLD_SEC's doc
    // comment for the real report this (and its shrunk trigger window)
    // was added for.
    const ranked = applyPlaybackPrefs(eligible, playbackPrefs).streams.slice(0, 2);
    const { winner } = await racePool<StremioStream, ResolveResponse>({
      candidates: ranked,
      concurrency: 1,
      signal: controller.signal,
      resolveOne: async (stream, _i, signal) => {
        try {
          return await resolveStream(stream, signal);
        } catch {
          return { ok: false };
        }
      },
      isSuccess: (r) => r.ok && !!r.playableUrl,
      // Still respects the same rate-limit signal live playback does —
      // this is best-effort, not urgent, but it's real traffic against
      // the same debrid account, so it must back off exactly like the
      // foreground pool does, not just because nothing's "waiting" on it.
      isRetryable: (r) => r.retryable !== false,
    });

    if (controller.signal.aborted) return;
    const winningStream = winner ? ranked[winner.index] : undefined;
    if (winner?.result.playableUrl && winningStream) {
      writePrefetchCache(metaId, nextVideoId, {
        url: winner.result.playableUrl,
        filename: winner.result.filename ?? null,
        remuxed: winner.result.remuxed ?? false,
        sourceIdentity: sourceIdentity(winningStream),
      });
    }
  }, [nextVideoId, prefetchNextEpisodeStreams, playbackPrefs, metaId, playingIndex, streams]);

  // A stable identity, not an inline arrow in the JSX — Player.tsx's own
  // progress-interval effect depends on this exact prop ([onProgress]),
  // so a fresh closure every render would tear that effect down and
  // rebuild it on every PlaybackControls re-render, not just when
  // something progress-relevant actually changes. Not confirmed as the
  // cause of any specific incident, but a real latent instability worth
  // closing off regardless.
  const handleProgress = useCallback(
    (positionSec: number, durationSec: number) => {
      lastKnownPositionRef.current = positionSec;
      reportProgress(metaId, mediaType, videoId, positionSec, durationSec);
      if (
        !hasTriggeredPrefetchResolve.current &&
        nextVideoId &&
        durationSec > 0 &&
        durationSec - positionSec <= NEAR_END_THRESHOLD_SEC
      ) {
        hasTriggeredPrefetchResolve.current = true;
        void resolveNextEpisodePrefetch();
      }
    },
    [metaId, mediaType, videoId, nextVideoId, resolveNextEpisodePrefetch],
  );

  const handleNextEpisode = useCallback(() => {
    if (!nextVideoId) return;
    router.push(`/title/${mediaType}/${metaId}?video=${encodeURIComponent(nextVideoId)}&autoplay=1`);
  }, [router, mediaType, metaId, nextVideoId]);

  /**
   * Fires once real playback has held for CONFIRMED_WORKING_THRESHOLD_SEC
   * (see Player.tsx) — remembers this exact source so a later visit to
   * this title tries it first (see prioritizeLastWorkingSource above),
   * and (real feature request: "so much time between episodes...")
   * kicks off Phase 1 of the next-episode prefetch. Best-effort like
   * reportProgress below: losing either write just means next time falls
   * back to normal behavior, not a broken experience.
   */
  const handleConfirmedWorking = useCallback(() => {
    if (nextVideoId) void prefetchNextEpisodeStreams();
    const stream = playingIndex !== null ? streams[playingIndex] : undefined;
    if (!stream) return;
    void fetch("/api/library/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metaId,
        type: mediaType,
        videoId,
        infoHash: stream.infoHash,
        fileIdx: stream.fileIdx,
        url: stream.url,
      }),
      keepalive: true,
    }).catch(() => {});
  }, [playingIndex, streams, metaId, mediaType, videoId, nextVideoId, prefetchNextEpisodeStreams]);

  // Runs once per mount only — PlaybackControls remounts fresh on every
  // episode navigation (full page nav, no `key` prop, fresh server
  // props), so there's no "videoId changed under me" case to react to.
  useEffect(() => {
    if (!autoPlayOnMount) return;
    const cached = consumePrefetchCache(metaId, videoId);
    if (cached) {
      const matchIndex = cached.sourceIdentity
        ? streams.findIndex((s) => sourceIdentity(s) === cached.sourceIdentity)
        : -1;
      setPlayerSource({ url: cached.url, format: "native" });
      setPlayingIndex(matchIndex >= 0 ? matchIndex : null);
      setPlayingFilename(cached.filename);
      setPlayingRemuxed(cached.remuxed);
    } else {
      // No fresh prefetch (didn't finish in time, or this is the first
      // episode with nothing to have prefetched) — falls back to the
      // exact same one-click resolve the manual "Play" button triggers,
      // so a Next Episode click is never worse than today, only
      // sometimes instant.
      void playIndex(0);
    }
    // Strips ?autoplay=1 so a manual refresh doesn't replay auto-play.
    router.replace(`/title/${mediaType}/${metaId}?video=${encodeURIComponent(videoId)}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!hasAddons) {
    return (
      <p className={styles.message}>
        No stream sources configured yet. Add a Stremio-compatible addon in Settings.
      </p>
    );
  }

  if (streams.length === 0) {
    return <p className={styles.message}>No sources found for this title yet.</p>;
  }

  // "Busy" spans both the resolve step AND the brief window after a
  // resolve succeeds but before Player confirms it's actually playing
  // (sourceReady) — picking a different source, or clicking Play again,
  // during either phase would just race against the in-flight attempt.
  const isBusy = resolvingIndices.size > 0 || (playerSource !== null && !sourceReady);

  return (
    <div>
      <div className={styles.row}>
        <button type="button" className={styles.primary} onClick={() => void playIndex(0)} disabled={isBusy}>
          {isBusy ? "Resolving…" : "Play"}
        </button>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => (isBusy ? stopResolving() : setSourcesOpen((open) => !open))}
          aria-expanded={sourcesOpen}
        >
          {isBusy ? "Stop" : sourcesOpen ? "Hide sources" : `All sources (${streams.length})`}
        </button>
      </div>

      {resolveError && <p className={styles.errorMessage}>{resolveError}</p>}
      {languageFilterFellBack && (
        <p className={styles.message}>
          No sources tagged for {LANGUAGE_OPTIONS.find((l) => l.code === playbackPrefs.preferredLanguage)?.label ?? "your language"} —
          showing all sources instead.
        </p>
      )}
      {compatibilityFilterFellBack && (
        <p className={styles.message}>
          Every source for this title is HEVC video, which this browser can&rsquo;t decode — showing them all
          anyway, since there&rsquo;s nothing better to offer. Try Chrome, Edge, or Safari for a better shot at
          playing one of these.
        </p>
      )}
      {trailerSkipped && (
        <p className={styles.message}>
          Skipped a source that turned out to be a trailer, not the full movie — its actual length didn&rsquo;t
          match. Automatically tried another one.
        </p>
      )}
      {noAudioSkipped && (
        <p className={styles.message}>
          Skipped a source with no audio — the browser confirmed it couldn&rsquo;t find a playable audio track,
          even after automatic conversion. Automatically tried another one.
        </p>
      )}

      {sourcesOpen && (
        // Fixed positioning (not normal flow) so this escapes TitleHero's
        // overflow-hidden, bottom-anchored content box — otherwise a list
        // longer than the hero's fixed height gets silently clipped with
        // no way to scroll to the missing rows. Same trick playerOverlay
        // below already relies on. stopResolving (not just closing the
        // panel) on backdrop click and the header's close button: clicking
        // away used to only hide the list while an auto-retry loop kept
        // running underneath and would force the panel back open on its
        // next failure regardless — this actually cancels it.
        <div className={styles.sourcesOverlay} onClick={stopResolving}>
          <div className={styles.sourcesPanel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.sourcesPanelHeader}>
              {isBusy ? <span className={styles.sourceText}>Trying sources…</span> : <span />}
              <button type="button" className={styles.sourcesClose} onClick={stopResolving} aria-label="Close">
                ×
              </button>
            </div>
            <ul className={styles.sourcesList}>
              {streams.map((stream, index) => (
                <li
                  key={stream.url ?? `${stream.infoHash ?? "stream"}:${stream.fileIdx ?? index}`}
                  className={index === playingIndex ? `${styles.sourceRow} ${styles.active}` : styles.sourceRow}
                >
                  <span className={styles.sourceText}>
                    {streamLabel(stream)}
                    {hasLikelyIncompatibleAudio(stream) && (
                      <span className={styles.audioWarning} title="This release's audio format (DTS/AC3/TrueHD/Atmos) isn't natively browser-playable, so it's converted automatically on play — takes a few extra seconds to start, and skipping around isn't supported.">
                        {" "}
                        ⚙ audio converted automatically
                      </span>
                    )}
                    {hevcUnplayable && hasLikelyHevcVideo(stream) && (
                      <span className={styles.audioWarning} title="This release is HEVC/x265 video, which this browser can't decode — it likely won't play at all.">
                        {" "}
                        ⚠ video may not play
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className={styles.sourcePlay}
                    onClick={() => void playIndex(index)}
                    disabled={isBusy}
                  >
                    {resolvingIndices.has(index) ? "Resolving…" : "Play"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {(resolvingIndices.size > 0 || playerSource) && (
        <div className={styles.playerOverlay}>
          <div className={styles.playerFrame}>
            {!playerSource && (
              // No candidate has resolved yet — nothing to mount/hide behind, just the screen itself.
              // This is a fixed, full-screen overlay (see .playerOverlay), so the Play/Stop row above
              // it is now covered and unreachable — this Cancel button is the only way out while it's up.
              <div className={styles.testingSourcesScreen} role="status">
                <div className={styles.testingSourcesSpinner} aria-hidden="true" />
                <p>Testing sources…</p>
                <button type="button" className={styles.secondary} onClick={stopResolving}>
                  Cancel
                </button>
              </div>
            )}
            {sourceReady && (
              <>
                {!playingRemuxed && playingFilename && isLikelyUnplayableContainer(playingFilename) && (
                  <p className={styles.audioWarningBanner} role="status">
                    Black or frozen screen? This file (<strong>{playingFilename}</strong>) is an MKV (or similar)
                    container — resolving worked and the file is real, but browsers can&rsquo;t play that container
                    directly, so nothing loads. This isn&rsquo;t a Skybox bug to keep retrying past. Try a different
                    source from &ldquo;All sources&rdquo; — an MP4/WEBRip release is more likely to actually play.
                  </p>
                )}
                {/* Should be rare: resolve-stream decides to remux MKV whenever this browser can't
                    play it natively, so `playingRemuxed` normally covers this. This only fires if
                    that server-side remux itself failed and fell back to a raw passthrough (see
                    stream-proxy.ts) — the file arrived as unconverted MKV despite the decision. */}
                {!playingRemuxed && playingFilename && mkvUnplayable && isMkvContainer(playingFilename) && (
                  <p className={styles.audioWarningBanner} role="status">
                    Black or frozen screen? This file (<strong>{playingFilename}</strong>) is an MKV container this
                    browser can&rsquo;t play natively, and the server-side conversion that usually fixes this didn&rsquo;t
                    complete. This isn&rsquo;t a Skybox bug to keep retrying past. Try a different source from
                    &ldquo;All sources&rdquo;, or use Firefox 145+, which plays MKV directly.
                  </p>
                )}
                {hevcUnplayable &&
                  playingIndex !== null &&
                  streams[playingIndex] &&
                  hasLikelyHevcVideo(streams[playingIndex]!) && (
                    <p className={styles.audioWarningBanner} role="status">
                      Black or frozen screen? This release is encoded in HEVC/x265 video, which this browser
                      can&rsquo;t decode at all — very common for 4K/HDR/Dolby Vision releases. This isn&rsquo;t a
                      Skybox bug to keep retrying past. Try a different source from &ldquo;All sources&rdquo; (look
                      for x264/H.264/AVC instead), or open Skybox in Chrome, Edge, or Safari, which can usually
                      play HEVC.
                    </p>
                  )}
                {playingRemuxed && (
                  <p className={styles.audioWarningBanner} role="status">
                    This source needed automatic conversion to play in this browser (an incompatible audio format,
                    container, or both) — it&rsquo;s being fixed on the fly. May take a moment longer to start, and
                    the scrub bar won&rsquo;t seek correctly on this source.
                  </p>
                )}
                {showNextEpisodePrompt && nextVideoId && (
                  <div className={styles.nextEpisodePrompt} role="status">
                    <span className={styles.sourceText}>
                      {nextEpisodeLabel ? `Up next: ${nextEpisodeLabel}` : "Up next"}
                    </span>
                    <button type="button" className={styles.primary} onClick={handleNextEpisode}>
                      Next Episode
                    </button>
                  </div>
                )}
              </>
            )}
            {playerSource && (
              <>
                {!sourceReady && (
                  <div className={styles.testingSourcesOverlay} role="status">
                    <div className={styles.testingSourcesSpinner} aria-hidden="true" />
                    <p>Testing sources…</p>
                    <button type="button" className={styles.secondary} onClick={stopResolving}>
                      Cancel
                    </button>
                  </div>
                )}
                <Player
                  source={playerSource}
                  title={title}
                  poster={poster}
                  onClose={() => setPlayerSource(null)}
                  onSourceFailed={handleSourceFailed}
                  onNoAudioTrackDetected={handleNoAudioDetected}
                  onLikelyTrailer={handleLikelyTrailer}
                  expectedRuntimeMinutes={expectedRuntimeMinutes}
                  onPlaybackReady={() => setSourceReady(true)}
                  onConfirmedWorking={handleConfirmedWorking}
                  onProgress={handleProgress}
                  startPositionSec={lastKnownPositionRef.current}
                  onEnded={() => nextVideoId && setShowNextEpisodePrompt(true)}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
