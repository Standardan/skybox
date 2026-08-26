"use client";

import { useCallback, useMemo, useState } from "react";
import { isCached, detectResolution } from "@skybox/core/addon-client";
import type { MediaType, PlaybackPrefs, StremioStream } from "@skybox/core/shared";
import { Player, type PlayerSource } from "@/components/Player";
import styles from "./PlaybackControls.module.css";

/**
 * `aggregateStreams` already ranks cached-first-then-resolution by default
 * (matching the `preferCached: true` default). This re-sorts using the same
 * detection when the user's actual saved preference differs — resolution
 * priority first when cache isn't preferred, and a specific resolution
 * pinned to the front when one is chosen. Stable otherwise (preserves
 * `aggregateStreams`' own tie-break order).
 */
function applyPlaybackPrefs(streams: StremioStream[], prefs: PlaybackPrefs): StremioStream[] {
  return streams
    .map((stream, index) => ({ stream, index }))
    .sort((a, b) => {
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
}

async function resolveStream(stream: StremioStream): Promise<ResolveResponse> {
  const res = await fetch("/api/resolve-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      infoHash: stream.infoHash,
      fileIdx: stream.fileIdx,
      url: stream.url,
    }),
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

  const streams = useMemo(() => applyPlaybackPrefs(rawStreams, playbackPrefs), [rawStreams, playbackPrefs]);

  const playIndex = useCallback(
    async (index: number) => {
      const stream = streams[index];
      if (!stream) return;
      setResolvingIndex(index);
      setResolveError(null);
      try {
        const result = await resolveStream(stream);
        if (!result.ok || !result.playableUrl) {
          setResolveError(result.message ?? "Failed to resolve this source.");
          setResolvingIndex(null);
          return;
        }
        setPlayerSource({ url: result.playableUrl, format: "native" });
        setPlayingIndex(index);
      } catch {
        setResolveError("Failed to resolve this source. Check your connection and try again.");
      } finally {
        setResolvingIndex(null);
      }
    },
    [streams],
  );

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
          {resolvingIndex === 0 ? "Resolving…" : "Play"}
        </button>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => setSourcesOpen((open) => !open)}
          aria-expanded={sourcesOpen}
        >
          {sourcesOpen ? "Hide sources" : `All sources (${streams.length})`}
        </button>
      </div>

      {resolveError && <p className={styles.errorMessage}>{resolveError}</p>}

      {sourcesOpen && (
        <ul className={styles.sourcesPanel}>
          {streams.map((stream, index) => (
            <li
              key={stream.url ?? `${stream.infoHash ?? "stream"}:${stream.fileIdx ?? index}`}
              className={index === playingIndex ? `${styles.sourceRow} ${styles.active}` : styles.sourceRow}
            >
              <span className={styles.sourceText}>{streamLabel(stream)}</span>
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
      )}

      {playerSource && (
        <div className={styles.playerOverlay}>
          <div className={styles.playerFrame}>
            <Player
              source={playerSource}
              title={title}
              poster={poster}
              onClose={() => setPlayerSource(null)}
              onSourceFailed={handleSourceFailed}
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
