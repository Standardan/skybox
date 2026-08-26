"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
   * Fires periodically (roughly every 15s, throttled) and on pause/unmount —
   * never on every timeupdate tick — so the caller can persist resume
   * position (B7). Omit in live-TV mode; there's nothing to "continue
   * watching" for a live channel.
   */
  onProgress?: (positionSec: number, durationSec: number) => void;
  /** Seeks here once playback metadata loads — the other half of "resume where you left off" (B7). Omit to start at 0. */
  startPositionSec?: number;
}

const AUTO_HIDE_MS = 3000;

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
  onProgress,
  startPositionSec,
}: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSeekedToStart = useRef(false);
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
            if (data.fatal) handleFailure();
          });
        } else {
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

  const handleFailure = useCallback(() => {
    const video = videoRef.current;
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
  }, [retried, onSourceFailed]);

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
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onLoadedMetadata={(e) => {
          if (hasSeekedToStart.current) return;
          hasSeekedToStart.current = true;
          const video = e.currentTarget;
          // A few seconds of slack: don't bother seeking into the last
          // moments of a title, or resuming would just replay the ending.
          if (startPositionSec && video.duration && startPositionSec < video.duration - 5) {
            video.currentTime = startPositionSec;
          }
        }}
        onVolumeChange={(e) => setVolume(e.currentTarget.volume)}
        onError={handleFailure}
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
