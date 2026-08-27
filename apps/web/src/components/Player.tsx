"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isLikelyTrailerRuntime } from "@skybox/core/shared";
import styles from "./Player.module.css";

export interface PlayerNowNext {
  now: { title: string; start: number; stop: number } | null;
  next: { title: string; start: number; stop: number } | null;
}

export interface PlayerSource {
  url: string;
  /** "hls" needs hls.js in browsers without native HLS (everything but Safari); "native" is a direct-playable file (e.g. debrid-resolved MKV/H.264/AC3 — see docs/07-DECISIONS.md D-015). */
  format: "hls" | "native";
}

export interface PlayerProps {
  source: PlayerSource;
  title: string;
  poster?: string;
  /** Present only in live-TV mode. */
  live?: {
    channelName: string;
    channelLogo?: string;
    nowNext: PlayerNowNext | null;
    onChannelUp: () => void;
    onChannelDown: () => void;
  };
  onClose?: () => void;
  /** Called when playback fails after the automatic retry — the caller owns "try the next source" (F6). */
  onSourceFailed?: () => void;
  /**
   * Fires once per source, at most, when the browser confirms real
   * playback started but decoded zero audio tracks — see the effect below
   * for why this beats guessing from the filename. Omit to skip the
   * check entirely (e.g. live TV, where audio silently failing isn't
   * currently surfaced this way).
   */
  onNoAudioTrackDetected?: () => void;
  /**
   * Fires once, from `onLoadedMetadata`, when the real (now-known)
   * duration of what's actually playing comes out suspiciously short
   * next to `expectedRuntimeMinutes` — see runtime-check.ts's doc
   * comment for why this is a reliable trailer-vs-real-movie signal.
   * Omit `expectedRuntimeMinutes` (e.g. live TV, or no Cinemeta runtime
   * data) to skip the check entirely.
   */
  onLikelyTrailer?: () => void;
  /** Cinemeta's stated runtime in minutes — see onLikelyTrailer above. */
  expectedRuntimeMinutes?: number;
  /**
   * Fires once per source, at most, once real playback has held for
   * CONFIRMED_WORKING_THRESHOLD_SEC of actual video time (not wall-clock
   * — pausing partway through, e.g. to check something, doesn't reset or
   * delay this; only genuinely elapsed playback counts) with none of the
   * other failure signals (audio silence, wrong runtime, a plain error
   * event) having fired. The caller remembers this source so a later
   * visit tries it first (B7-adjacent feature request: "if it's working
   * right now, use that one first next time").
   */
  onConfirmedWorking?: () => void;
  /**
   * Fires once per source, the first time the native `playing` event
   * confirms real frames have started rendering — NOT the same as a
   * resolve succeeding (a resolved URL can still fail to decode). Real
   * feature request: replace the confusing flash of a half-broken player
   * (black/frozen frame, controls visible) while cycling through bad
   * candidates with a clean "Testing sources…" screen that only lifts
   * once this fires. Deliberately a much lower bar than
   * onConfirmedWorking's CONFIRMED_WORKING_THRESHOLD_SEC — this is about
   * hiding the resolve/attempt churn, not about deciding whether to
   * remember this source for next time.
   */
  onPlaybackReady?: () => void;
  /**
   * Fires periodically (roughly every 15s, throttled) and on pause/unmount —
   * never on every timeupdate tick — so the caller can persist resume
   * position (B7). Omit in live-TV mode; there's nothing to "continue
   * watching" for a live channel.
   */
  onProgress?: (positionSec: number, durationSec: number) => void;
  /** Seeks here once playback metadata loads — the other half of "resume where you left off" (B7). Omit to start at 0. */
  startPositionSec?: number;
  /** Fires once the video reaches its natural end (not on a failure/skip) — lets the caller offer a "Next Episode" prompt. */
  onEnded?: () => void;
}

const AUTO_HIDE_MS = 3000;
// Elapsed VIDEO time, not wall-clock — deliberately based on currentTime
// rather than a setTimeout, so pausing partway through (a normal, real
// user action, not a failure) never resets or delays this; only time
// actually spent playing counts toward the threshold.
const CONFIRMED_WORKING_THRESHOLD_SEC = 10;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Reference: docs/05-UX.md §Player. Lineage: player anatomy adapted from
 * Uiverse `Inputs/Darlley_hard-quail-33` (play/pause + scrub track + time
 * labels) composed with MDC `mdc-slider`'s keyboard/ARIA scrub semantics —
 * see DESIGN-BRIEF.md §8. Scrub/progress updates stay instant per the
 * Motion Contract (§7) — no eased tweening on the fill.
 */
export function Player({
  source,
  title,
  poster,
  live,
  onClose,
  onSourceFailed,
  onNoAudioTrackDetected,
  onLikelyTrailer,
  expectedRuntimeMinutes,
  onPlaybackReady,
  onConfirmedWorking,
  onProgress,
  startPositionSec,
  onEnded,
}: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSeekedToStart = useRef(false);
  const hasConfirmedWorking = useRef(false);
  const hasFiredPlaybackReady = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [errored, setErrored] = useState(false);
  const [retried, setRetried] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Throttled progress reporting — fires on a timer while playing, plus
  // once more on pause/unmount so the last position before the user stops
  // watching is never lost.
  const lastReportedAt = useRef(0);
  const latestTimeRef = useRef({ currentTime: 0, duration: 0 });
  latestTimeRef.current = { currentTime, duration };

  useEffect(() => {
    if (!onProgress) return;
    const interval = setInterval(() => {
      const { currentTime: t, duration: d } = latestTimeRef.current;
      if (d > 0 && Date.now() - lastReportedAt.current >= 15_000) {
        lastReportedAt.current = Date.now();
        onProgress(t, d);
      }
    }, 15_000);
    return () => {
      clearInterval(interval);
      const { currentTime: t, duration: d } = latestTimeRef.current;
      if (d > 0) onProgress(t, d);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onProgress]);

  // --- source attach (native HLS vs hls.js vs direct file) ---------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setErrored(false);
    setRetried(false);
    // A genuinely new source (e.g. F6's "try next source" after a failure)
    // should still resume at the same spot — same title, different URL.
    hasSeekedToStart.current = false;
    hasConfirmedWorking.current = false;
    hasFiredPlaybackReady.current = false;

    let hls: import("hls.js").default | null = null;

    if (source.format === "hls" && !video.canPlayType("application/vnd.apple.mpegurl")) {
      let cancelled = false;
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          hls = new Hls();
          hls.loadSource(source.url);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (data.fatal) handleFailure(data);
          });
        } else {
          console.error("[Player] hls.js reports this browser can't play HLS at all", { url: source.url });
          setErrored(true);
        }
      });
      return () => {
        cancelled = true;
        hls?.destroy();
      };
    }

    video.src = source.url;
    return () => {
      video.removeAttribute("src");
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.url, source.format]);

  /**
   * Real report this fixes: a release with no audio-codec hint in its
   * title at all (so the filename-based DTS/AC3/TrueHD/Atmos heuristic in
   * PlaybackControls has nothing to match against) played video fine but
   * was completely silent — most likely an untagged EAC3/DD+ track,
   * common on WEB-DL sources from a streaming service, which a browser
   * still can't decode even though nothing in the name says so.
   *
   * First attempt at this used `audioTracks.length === 0` — confirmed
   * wrong by a real retest that still showed no banner: `audioTracks`
   * reflects tracks the DEMUXER found in the container, not whether the
   * DECODER can actually produce sound from one, so a track the browser
   * can enumerate but can't decode still counts as "1 track" there. This
   * uses two read-only diagnostic properties instead — deliberately NOT
   * the Web Audio API (`createMediaElementSource` would hijack the
   * video's actual audio output through a new graph the caller has to
   * route back to `destination` correctly, and getting that wrong risks
   * silencing audio that would otherwise have played fine, which is a
   * far worse regression than an occasional missing warning banner):
   * Firefox's `mozHasAudio` ("contains an audio track that can be
   * played" — decodability, not just presence) and Safari/WebKit's
   * legacy `webkitAudioDecodedByteCount` (real decoded-byte count, so
   * still 0 for a track that exists but can't decode). Neither touches
   * playback in any way — pure readback.
   *
   * A single check a couple seconds after `playing` (the first version
   * of this) still missed a real, confirmed-silent file — a manual
   * console check on the same file, tens of minutes into playback,
   * showed `mozHasAudio: false` correctly, meaning the browser did
   * eventually know, just not within that first couple of seconds. Over
   * a proxied network stream (this app fetches the real bytes through
   * /api/stream-proxy, not a local file) the decoder may need more than
   * a couple seconds of buffered data before it can tell decode is
   * failing. This now polls periodically instead of checking once,
   * stopping as soon as it gets a definitive answer either way (real
   * decoded bytes confirm audio IS fine — no need to keep polling — or
   * a confirmed-false/zero fires the warning) or after a generous cap.
   * Reported up via a callback (rather than rendered here) so it lands
   * in the same banner style as PlaybackControls' other warnings.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onNoAudioTrackDetected) return;

    // Real report: a silent source used to get revealed (onPlaybackReady
    // firing on the native `playing` event, independent of this check)
    // and keep visibly/audibly playing for several seconds before this
    // poll caught up and PlaybackControls auto-skipped it — "it shouldn't
    // have let me even press play and start watching it." Fixed by making
    // THIS check the gate for revealing at all, when it's able to run:
    // reveal (fire onPlaybackReady) only once audio is actually confirmed
    // present, or once this gives up waiting (fail open, same reasoning
    // as PlaybackControls' own SOURCE_READY_FALLBACK_MS — under-waiting
    // costs an unnecessary skip at worst, over-waiting traps the viewer
    // behind a loading screen), or immediately if this browser can't run
    // the check at all (nothing to gain by waiting). Confirmed silence
    // skips straight to the next candidate — never revealed to begin
    // with, not revealed-then-retroactively-hidden.
    //
    // Detection can't happen before real playback starts (mozHasAudio/
    // webkitAudioDecodedByteCount are meaningless until frames are
    // actually decoding), but once it can, it should be fast — shrunk the
    // interval 5x (2000ms -> 400ms) and upped the consecutive-check count
    // (2 -> 3) so the debounce against one transient bad reading is if
    // anything MORE robust, while the worst-case time-to-confirm-audio
    // drops from ~4s to ~1.2s. MAX_CHECKS scaled to preserve the same
    // ~30s overall give-up window.
    const POLL_INTERVAL_MS = 400;
    const MAX_CHECKS = 75; // ~30s of real playback before giving up either way
    const CONSECUTIVE_SILENT_TO_FIRE = 3; // debounce against a transient reading right as playback starts
    let checks = 0;
    let consecutiveSilent = 0;
    let poll: ReturnType<typeof setInterval> | null = null;
    let settled = false; // revealed or skipped — only one of those, ever, per source

    function stopPolling() {
      if (poll) clearInterval(poll);
      poll = null;
    }

    function reveal() {
      if (settled) return;
      settled = true;
      stopPolling();
      if (onPlaybackReady && !hasFiredPlaybackReady.current) {
        hasFiredPlaybackReady.current = true;
        onPlaybackReady();
      }
    }

    function skipSilent() {
      if (settled) return;
      settled = true;
      stopPolling();
      onNoAudioTrackDetected?.();
    }

    // Fires as soon as N consecutive checks agree on silence — whether
    // that happens on check #2 (settles immediately) or check #12
    // (settles late, e.g. over a slow proxied stream) — rather than only
    // ever firing right at the end of the polling window.
    function checkForSilence() {
      if (!video || settled) return stopPolling();
      checks++;
      const v = video as unknown as { mozHasAudio?: boolean; webkitAudioDecodedByteCount?: number };
      let silentThisCheck: boolean | null = null;
      if (typeof v.mozHasAudio === "boolean") {
        silentThisCheck = !v.mozHasAudio;
      } else if (typeof v.webkitAudioDecodedByteCount === "number") {
        silentThisCheck = v.webkitAudioDecodedByteCount === 0;
      } else {
        return reveal(); // neither property supported (e.g. some browsers) — nothing to gain by waiting
      }

      if (silentThisCheck) {
        consecutiveSilent++;
        if (consecutiveSilent >= CONSECUTIVE_SILENT_TO_FIRE) return skipSilent();
      } else {
        return reveal(); // confirmed real decoded audio
      }
      if (checks >= MAX_CHECKS) return reveal(); // give up waiting — fail open, not closed
    }

    function onPlaying() {
      stopPolling();
      checks = 0;
      consecutiveSilent = 0;
      poll = setInterval(checkForSilence, POLL_INTERVAL_MS);
    }
    video.addEventListener("playing", onPlaying);
    return () => {
      video.removeEventListener("playing", onPlaying);
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.url]);

  const handleFailure = useCallback(
    (hlsErrorData?: unknown) => {
      const video = videoRef.current;
      // This used to discard whatever actually went wrong, so "This source
      // failed to play" was a dead end to debug from the outside — no way
      // to tell a real network/manifest error from something else. Real
      // MediaError code/message (native <video>) or hls.js's own error
      // object (fatal network/media/other errors, with a `details` string
      // like manifestLoadError/bufferStalledError/etc.) now land in the
      // browser console with the source URL, so a report like "every
      // channel fails" is actually diagnosable.
      console.error("[Player] playback failed", {
        url: source.url,
        format: source.format,
        videoError: video?.error ? { code: video.error.code, message: video.error.message } : null,
        hlsErrorData,
      });
      if (!retried && video) {
        // One same-source retry (transient network blip) before escalating to
        // the caller's next-best-source path — F6, never a dead black screen.
        setRetried(true);
        video.load();
        video.play().catch(() => setErrored(true));
        return;
      }
      setErrored(true);
      onSourceFailed?.();
    },
    [retried, onSourceFailed, source.url, source.format],
  );

  // --- chrome auto-hide ----------------------------------------------------
  const wakeChrome = useCallback(() => {
    setChromeVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (playing) {
      hideTimer.current = setTimeout(() => setChromeVisible(false), AUTO_HIDE_MS);
    }
  }, [playing]);

  useEffect(() => {
    wakeChrome();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [wakeChrome]);

  // --- transport actions -----------------------------------------------
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);

  const seekBy = useCallback((deltaSec: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + deltaSec));
  }, []);

  const seekTo = useCallback((fraction: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = fraction * video.duration;
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      // Fullscreens the whole chrome container, not just <video> — so the
      // custom controls/scrub bar stay usable in fullscreen instead of
      // falling back to the browser's native video-only fullscreen.
      void playerRef.current?.requestFullscreen();
    }
  }, []);

  // Browsers also exit fullscreen from outside our button (Escape, the
  // browser's own UI) — mirror that into state rather than trusting only
  // our own toggle to keep it in sync.
  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // --- keyboard shortcuts (docs/05-UX.md §Player) -----------------------
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      wakeChrome();
      switch (e.key) {
        case " ":
        case "Enter":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          seekBy(-10);
          break;
        case "ArrowRight":
          seekBy(10);
          break;
        case "ArrowUp":
          if (live) {
            e.preventDefault();
            live.onChannelUp();
          }
          break;
        case "ArrowDown":
          if (live) {
            e.preventDefault();
            live.onChannelDown();
          }
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "Escape":
          // The browser already exits fullscreen on its own for this key —
          // don't also close the whole player on the same press. A second
          // Escape (now not fullscreen) closes it as usual.
          if (document.fullscreenElement) break;
          onClose?.();
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlay, seekBy, live, onClose, wakeChrome, toggleFullscreen]);

  const progressFraction = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      ref={playerRef}
      className={`${styles.player} ${chromeVisible ? "" : styles.chromeHidden}`}
      onMouseMove={wakeChrome}
      onPointerDown={wakeChrome}
    >
      <video
        ref={videoRef}
        className={styles.video}
        poster={poster}
        autoPlay
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          if (onProgress && duration > 0) {
            lastReportedAt.current = Date.now();
            onProgress(currentTime, duration);
          }
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setCurrentTime(t);
          if (onConfirmedWorking && !hasConfirmedWorking.current && t >= CONFIRMED_WORKING_THRESHOLD_SEC) {
            hasConfirmedWorking.current = true;
            onConfirmedWorking();
          }
        }}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onLoadedMetadata={(e) => {
          if (hasSeekedToStart.current) return;
          hasSeekedToStart.current = true;
          const video = e.currentTarget;
          if (
            onLikelyTrailer &&
            expectedRuntimeMinutes &&
            Number.isFinite(video.duration) &&
            isLikelyTrailerRuntime(video.duration, expectedRuntimeMinutes)
          ) {
            onLikelyTrailer();
            return; // not the real movie — resuming into it wouldn't mean anything.
          }
          // A few seconds of slack: don't bother seeking into the last
          // moments of a title, or resuming would just replay the ending.
          if (startPositionSec && video.duration && startPositionSec < video.duration - 5) {
            video.currentTime = startPositionSec;
          }
        }}
        onVolumeChange={(e) => setVolume(e.currentTarget.volume)}
        onPlaying={() => {
          // When a caller wants audio-silence detection (PlaybackControls,
          // via onNoAudioTrackDetected), THAT effect owns revealing —
          // gated on audio actually being confirmed present, so a silent
          // source is never shown at all rather than shown-then-hidden.
          // Callers that don't ask for audio detection (e.g. live TV)
          // keep the old direct behavior: reveal immediately.
          if (onPlaybackReady && !onNoAudioTrackDetected && !hasFiredPlaybackReady.current) {
            hasFiredPlaybackReady.current = true;
            onPlaybackReady();
          }
        }}
        onEnded={() => onEnded?.()}
        onError={() => handleFailure()}
        onClick={togglePlay}
      />

      {errored && (
        <div className={styles.errorState} role="alert">
          <p>This source failed to play.</p>
          {onSourceFailed && (
            <button type="button" onClick={onSourceFailed} className={styles.retryButton}>
              Try next source
            </button>
          )}
        </div>
      )}

      <div className={styles.chrome} aria-hidden={!chromeVisible}>
        {live && (
          <div className={styles.liveOverlay}>
            <div className={styles.liveChannel}>
              {live.channelLogo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={live.channelLogo} alt="" className={styles.liveLogo} />
              )}
              <span>{live.channelName}</span>
            </div>
            {live.nowNext?.now && (
              <div className={styles.nowNext}>
                <span className={styles.nowNextLabel}>Now</span> {live.nowNext.now.title}
                {live.nowNext.next && (
                  <>
                    {" "}
                    <span className={styles.nowNextLabel}>Next</span> {live.nowNext.next.title}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <div className={styles.titleRow}>
          <span className={styles.title}>{title}</span>
          {onClose && (
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close player">
              ×
            </button>
          )}
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.playButton}
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>

          {!live && (
            <>
              <span className={styles.time}>{formatTime(currentTime)}</span>
              <input
                type="range"
                className={styles.scrub}
                min={0}
                max={1}
                step={0.001}
                value={progressFraction}
                onChange={(e) => seekTo(Number(e.target.value))}
                aria-label="Seek"
                aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
              />
              <span className={styles.time}>{formatTime(duration)}</span>
            </>
          )}

          {live && (
            <div className={styles.liveBadge}>
              <span className={styles.liveDot} aria-hidden="true" />
              LIVE
            </div>
          )}

          <div className={styles.volumeGroup}>
            <input
              type="range"
              className={styles.volume}
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => {
                if (videoRef.current) videoRef.current.volume = Number(e.target.value);
              }}
              aria-label="Volume"
            />
          </div>

          <button
            type="button"
            className={styles.fullscreenButton}
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 9V5a1 1 0 0 1 1-1h4v2H6v3H4zM4 15v4a1 1 0 0 0 1 1h4v-2H6v-3H4zM20 9V5a1 1 0 0 0-1-1h-4v2h3v3h2zM20 15v4a1 1 0 0 1-1 1h-4v-2h3v-3h2z" />
    </svg>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9 4H5a1 1 0 0 0-1 1v4h2V6h3V4zM9 20H5a1 1 0 0 1-1-1v-4h2v3h3v2zM15 4h4a1 1 0 0 1 1 1v4h-2V6h-3V4zM15 20h4a1 1 0 0 0 1-1v-4h-2v3h-3v2z" />
    </svg>
  );
}
