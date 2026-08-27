"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  isCached,
  detectResolution,
  hasLikelyIncompatibleAudio,
  hasLikelyHevcVideo,
  isLikelyUnplayableContainer,
  matchesPreferredLanguage,
  LANGUAGE_OPTIONS,
} from "@skybox/core/addon-client";
import type { MediaType, PlaybackPrefs, StremioStream } from "@skybox/core/shared";
import { Player, type PlayerSource } from "@/components/Player";
import styles from "./PlaybackControls.module.css";

interface PlaybackPrefsResult {
  streams: StremioStream[];
  /** True only when a language filter was requested but matched nothing at all — the filter was skipped rather than leaving a dead "no sources" end for an otherwise-available title. */
  languageFilterFellBack: boolean;
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
  hevcSupportCache = support === "probably" || support === "maybe";
  return hevcSupportCache;
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
      // Same reasoning as the HEVC check above, for audio this time —
      // aggregateStreams already ranks by this server-side, but a
      // non-default resolution/cached preference re-sorts the whole list
      // here, which would otherwise undo that ordering.
      const aAudio = Number(hasLikelyIncompatibleAudio(a.stream));
      const bAudio = Number(hasLikelyIncompatibleAudio(b.stream));
      if (aAudio !== bAudio) return aAudio - bAudio;
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
      return a.index - b.index;
    })
    .map(({ stream }) => stream);

  if (prefs.preferredLanguage === "any") {
    return { streams: sorted, languageFilterFellBack: false };
  }
  const filtered = sorted.filter((stream) => matchesPreferredLanguage(stream, prefs.preferredLanguage));
  if (filtered.length === 0 && sorted.length > 0) {
    return { streams: sorted, languageFilterFellBack: true };
  }
  return { streams: filtered, languageFilterFellBack: false };
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

interface ResolveResponse {
  ok: boolean;
  playableUrl?: string;
  filename?: string;
  message?: string;
  /** false when this failure is connection-level (never reached the debrid provider at all) rather than specific to this source — every other source hits the same host and would fail identically, so the caller stops instead of grinding through the rest of the list. */
  retryable?: boolean;
}

async function resolveStream(stream: StremioStream, signal: AbortSignal): Promise<ResolveResponse> {
  const res = await fetch("/api/resolve-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      infoHash: stream.infoHash,
      fileIdx: stream.fileIdx,
      url: stream.url,
    }),
    signal,
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
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [resolvingIndex, setResolvingIndex] = useState<number | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [playerSource, setPlayerSource] = useState<PlayerSource | null>(null);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  // The REAL resolved filename (not a title guess) — lets the container
  // warning below be reliable instead of a heuristic, since this is the
  // exact file about to be handed to <video>.
  const [playingFilename, setPlayingFilename] = useState<string | null>(null);
  // Set by Player once it confirms real playback started with zero
  // decoded audio tracks — see Player.tsx's onNoAudioTrackDetected doc
  // comment. Catches releases with no audio-codec hint in the title at
  // all, which hasLikelyIncompatibleAudio below has nothing to match.
  const [noAudioTrackDetected, setNoAudioTrackDetected] = useState(false);
  // Owns the currently-running auto-retry loop (if any) so it can actually
  // be cancelled — a stuck/slow network request (a real report: ECONNRESET
  // hanging for a while before failing) used to keep the loop running with
  // no way to stop it short of navigating away entirely, since closing the
  // sources panel only hid it visually and the loop would just force it
  // back open on its next failure regardless.
  const abortRef = useRef<AbortController | null>(null);

  const { streams, languageFilterFellBack } = useMemo(
    () => applyPlaybackPrefs(rawStreams, playbackPrefs),
    [rawStreams, playbackPrefs],
  );
  // Computed once per mount (the answer can't change mid-session) — gates
  // the HEVC warning below so a viewer whose browser actually plays HEVC
  // fine (Chrome/Edge/Safari, mostly) never sees it.
  const hevcUnplayable = useMemo(() => !canBrowserPlayHevc(), []);

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
   * Stops immediately instead of exhausting the whole list when the server
   * marks a failure `retryable: false` (a connection-level failure that
   * never reached the debrid provider at all, e.g. a reset connection) —
   * every other source resolves through that exact same provider host and
   * would fail identically, so grinding through the rest is both pointless
   * and, worse, the actual cause of a real report: it read as "stuck
   * trying to resolve every source" with no way to tell it wasn't.
   */
  const playIndex = useCallback(
    async (startIndex: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      let lastMessage = "Failed to resolve this source.";
      for (let index = startIndex; index < streams.length; index++) {
        if (controller.signal.aborted) return;
        const stream = streams[index];
        if (!stream) continue;
        if (index > startIndex) setSourcesOpen(true);
        setResolvingIndex(index);
        setResolveError(null);
        try {
          const result = await resolveStream(stream, controller.signal);
          if (controller.signal.aborted) return;
          if (result.ok && result.playableUrl) {
            setPlayerSource({ url: result.playableUrl, format: "native" });
            setPlayingIndex(index);
            setPlayingFilename(result.filename ?? null);
            setNoAudioTrackDetected(false);
            setResolvingIndex(null);
            return;
          }
          lastMessage = result.message ?? lastMessage;
          if (result.retryable === false) break;
        } catch {
          if (controller.signal.aborted) return;
          lastMessage = "Failed to resolve this source. Check your connection and try again.";
        }
      }
      if (controller.signal.aborted) return;
      setResolvingIndex(null);
      setResolveError(lastMessage);
      setSourcesOpen(true);
    },
    [streams],
  );

  /** Cancels any in-flight resolve/retry loop immediately (aborts the network request too, not just future attempts) and closes the panel. */
  const stopResolving = useCallback(() => {
    abortRef.current?.abort();
    setResolvingIndex(null);
    setResolveError(null);
    setSourcesOpen(false);
  }, []);

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

  return (
    <div>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.primary}
          onClick={() => void playIndex(0)}
          disabled={resolvingIndex !== null}
        >
          {resolvingIndex !== null ? "Resolving…" : "Play"}
        </button>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => (resolvingIndex !== null ? stopResolving() : setSourcesOpen((open) => !open))}
          aria-expanded={sourcesOpen}
        >
          {resolvingIndex !== null ? "Stop" : sourcesOpen ? "Hide sources" : `All sources (${streams.length})`}
        </button>
      </div>

      {resolveError && <p className={styles.errorMessage}>{resolveError}</p>}
      {languageFilterFellBack && (
        <p className={styles.message}>
          No sources tagged for {LANGUAGE_OPTIONS.find((l) => l.code === playbackPrefs.preferredLanguage)?.label ?? "your language"} —
          showing all sources instead.
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
              {resolvingIndex !== null ? (
                <span className={styles.sourceText}>Trying sources…</span>
              ) : (
                <span />
              )}
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
                      <span className={styles.audioWarning} title="This release's audio format (DTS/AC3/TrueHD/Atmos) usually can't be played by a browser — video may be silent.">
                        {" "}
                        ⚠ audio may not play
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
                    disabled={resolvingIndex !== null}
                  >
                    {resolvingIndex === index ? "Resolving…" : "Play"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {playerSource && (
        <div className={styles.playerOverlay}>
          <div className={styles.playerFrame}>
            {playingFilename && isLikelyUnplayableContainer(playingFilename) && (
              <p className={styles.audioWarningBanner} role="status">
                Black or frozen screen? This file (<strong>{playingFilename}</strong>) is an MKV (or similar)
                container — resolving worked and the file is real, but browsers can&rsquo;t play that container
                directly, so nothing loads. This isn&rsquo;t a Skybox bug to keep retrying past. Try a different
                source from &ldquo;All sources&rdquo; — an MP4/WEBRip release is more likely to actually play.
              </p>
            )}
            {hevcUnplayable && playingIndex !== null && streams[playingIndex] && hasLikelyHevcVideo(streams[playingIndex]!) && (
              <p className={styles.audioWarningBanner} role="status">
                Black or frozen screen? This release is encoded in HEVC/x265 video, which this browser can&rsquo;t
                decode at all — very common for 4K/HDR/Dolby Vision releases. This isn&rsquo;t a Skybox bug to keep
                retrying past. Try a different source from &ldquo;All sources&rdquo; (look for x264/H.264/AVC
                instead), or open Skybox in Chrome, Edge, or Safari, which can usually play HEVC.
              </p>
            )}
            {playingIndex !== null && streams[playingIndex] && hasLikelyIncompatibleAudio(streams[playingIndex]!) && (
              <p className={styles.audioWarningBanner} role="status">
                No sound? This release&rsquo;s audio format (DTS/AC3/TrueHD/Atmos) usually can&rsquo;t be played by a
                browser — the video itself is fine. Try a different source from &ldquo;All sources&rdquo; labeled AAC
                for audio that actually plays.
              </p>
            )}
            {noAudioTrackDetected &&
              !(playingIndex !== null && streams[playingIndex] && hasLikelyIncompatibleAudio(streams[playingIndex]!)) && (
                <p className={styles.audioWarningBanner} role="status">
                  No sound? This file&rsquo;s release name didn&rsquo;t say so, but the browser confirms it couldn&rsquo;t
                  find a playable audio track — the video itself is fine. This is common on WEB-DL sources with an
                  untagged DTS/AC3/E-AC3 track. Try a different source from &ldquo;All sources&rdquo;.
                </p>
              )}
            <Player
              source={playerSource}
              title={title}
              poster={poster}
              onClose={() => setPlayerSource(null)}
              onSourceFailed={handleSourceFailed}
              onNoAudioTrackDetected={() => setNoAudioTrackDetected(true)}
              onProgress={(positionSec, durationSec) =>
                reportProgress(metaId, mediaType, videoId, positionSec, durationSec)
              }
              startPositionSec={resumePositionSec}
            />
          </div>
        </div>
      )}
    </div>
  );
}
