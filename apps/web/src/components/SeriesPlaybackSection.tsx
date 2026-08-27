"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  LastWorkingSource,
  MediaType,
  PlaybackPrefs,
  StremioStream,
  StremioVideo,
  WatchProgress,
} from "@skybox/core/shared";
import { findNextEpisode } from "@/lib/episode-order";
import { TitleHero } from "@/components/TitleHero";
import { PlaybackControls } from "@/components/PlaybackControls";
import { EpisodePicker } from "@/components/EpisodePicker";
import styles from "./PlaybackControls.module.css";

/**
 * Real feature request: switching seasons or picking an episode used to be
 * a full page navigation (EpisodePicker was pure server-rendered <Link>s),
 * resetting scroll position every time, and playback required a separate
 * two-step "select an episode, then scroll back up to a big Play button"
 * flow. This component owns episode selection as CLIENT state instead —
 * season/episode switching becomes a local re-render (no navigation, no
 * scroll reset by construction), and EpisodePicker's own inline per-row
 * Play buttons can trigger playback directly.
 *
 * PlaybackControls itself is completely unchanged — this is only about
 * *when* and *how* it gets fed a videoId/streams, not its own resolve/play
 * logic. Keyed by `${selectedVideoId}:${playNonce}` so it cleanly remounts
 * (preserving every one of its "fresh mount per episode" assumptions) on
 * every selection, including a same-episode replay (playNonce alone covers
 * the case where videoId doesn't change but the user clicks Play again).
 *
 * Renders both TitleHero and EpisodePicker as siblings (matching the
 * title page's original DOM layout exactly — hero on top, episode list
 * below) so the whole hero/episode-picker region can share one piece of
 * client state without needing any portal/slot trick.
 */
export function SeriesPlaybackSection({
  type,
  metaId,
  mediaType,
  backgroundUrl,
  title,
  meta,
  synopsis,
  poster,
  videos,
  initialVideoId,
  initialStreams,
  hasAddons,
  playbackPrefs,
  expectedRuntimeMinutes,
  libraryProgress,
  lastWorkingSource,
  autoPlayOnMount,
  watchlistToggle,
}: {
  type: string;
  metaId: string;
  mediaType: MediaType;
  backgroundUrl?: string;
  /** Bare show name — this component builds "Show · Episode Title" itself, per selection. */
  title: string;
  meta?: string;
  synopsis?: string;
  poster?: string;
  videos: StremioVideo[];
  initialVideoId: string;
  initialStreams: StremioStream[];
  hasAddons: boolean;
  playbackPrefs: PlaybackPrefs;
  expectedRuntimeMinutes?: number;
  /** The show's single saved progress record, if any — not per-episode (LibraryItem only ever holds one). Compared against the current selection below. */
  libraryProgress?: WatchProgress;
  lastWorkingSource?: LastWorkingSource;
  autoPlayOnMount: boolean;
  watchlistToggle: ReactNode;
}) {
  const router = useRouter();
  const [selectedVideoId, setSelectedVideoId] = useState(initialVideoId);
  const [streams, setStreams] = useState(initialStreams);
  const [isLoadingStreams, setIsLoadingStreams] = useState(false);
  const [streamsFetchFailed, setStreamsFetchFailed] = useState(false);
  const [pendingAutoPlay, setPendingAutoPlay] = useState(autoPlayOnMount);
  const [playNonce, setPlayNonce] = useState(0);

  async function handleSelectEpisode(videoId: string, { autoPlay }: { autoPlay: boolean }) {
    if (videoId === selectedVideoId) {
      // Already the current selection — nothing to re-fetch. Still bump
      // playNonce on a Play click so PlaybackControls remounts and
      // re-triggers autoplay even for a replay of the same episode.
      if (autoPlay) {
        setPlayNonce((n) => n + 1);
        setPendingAutoPlay(true);
      }
      return;
    }
    setSelectedVideoId(videoId);
    setPlayNonce((n) => n + 1);
    setPendingAutoPlay(autoPlay);
    setStreamsFetchFailed(false);
    setIsLoadingStreams(true);
    try {
      const res = await fetch(`/api/streams?type=${type}&id=${encodeURIComponent(videoId)}`);
      const data = (await res.json()) as { streams?: StremioStream[] };
      setStreams(data.streams ?? []);
    } catch {
      setStreamsFetchFailed(true);
      setStreams([]);
    } finally {
      setIsLoadingStreams(false);
    }
  }

  // URL bookkeeping only (shareable/bookmarkable/refresh-safe) — the UI
  // itself is driven by selectedVideoId, not this. { scroll: false } is
  // the same flag PlaybackControls' own autoPlayOnMount effect already
  // uses elsewhere in this app; on the "select + autoplay" path both
  // effects call replace() with the same resulting URL, which is
  // harmless (idempotent replace, no extra history entry).
  useEffect(() => {
    router.replace(`/title/${type}/${metaId}?video=${encodeURIComponent(selectedVideoId)}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVideoId]);

  const nextEpisode = useMemo(() => findNextEpisode(videos, selectedVideoId), [videos, selectedVideoId]);
  const currentEpisode = useMemo(() => videos.find((v) => v.id === selectedVideoId), [videos, selectedVideoId]);
  const playerTitle = currentEpisode?.title ? `${title} · ${currentEpisode.title}` : title;
  const resumePositionSec =
    libraryProgress && libraryProgress.videoId === selectedVideoId ? libraryProgress.positionSec : undefined;

  return (
    <>
      <TitleHero
        backgroundUrl={backgroundUrl}
        title={title}
        meta={meta}
        synopsis={synopsis}
        actions={
          <>
            {isLoadingStreams ? (
              <p key="loading" className={styles.message}>
                Loading episode…
              </p>
            ) : streamsFetchFailed ? (
              <p key="failed" className={styles.errorMessage}>
                Couldn&rsquo;t load sources for this episode. Try again.
              </p>
            ) : (
              <PlaybackControls
                key={`${selectedVideoId}:${playNonce}`}
                streams={streams}
                hasAddons={hasAddons}
                title={playerTitle}
                poster={poster}
                metaId={metaId}
                mediaType={mediaType}
                videoId={selectedVideoId}
                playbackPrefs={playbackPrefs}
                resumePositionSec={resumePositionSec}
                expectedRuntimeMinutes={expectedRuntimeMinutes}
                lastWorkingSource={lastWorkingSource}
                nextVideoId={nextEpisode?.id}
                nextEpisodeLabel={
                  nextEpisode?.title || (nextEpisode ? `Episode ${nextEpisode.episode ?? ""}` : undefined)
                }
                autoPlayOnMount={pendingAutoPlay}
              />
            )}
            {/* watchlistToggle is created server-side in page.tsx and passed down as a prop — wrapping it
                here (rather than spreading it bare as a Fragment sibling) gives it a stable key across
                that server/client boundary, which React's reconciler otherwise warns about. */}
            <div key="watchlist-toggle">{watchlistToggle}</div>
          </>
        }
      />
      <EpisodePicker
        videos={videos}
        selectedVideoId={selectedVideoId}
        onSelectEpisode={(videoId) => void handleSelectEpisode(videoId, { autoPlay: false })}
        onPlayEpisode={(videoId) => void handleSelectEpisode(videoId, { autoPlay: true })}
      />
    </>
  );
}
