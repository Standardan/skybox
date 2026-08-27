"use client";

import { useEffect, useState } from "react";
import type { StremioVideo } from "@skybox/core/shared";
import styles from "./EpisodePicker.module.css";

/**
 * Season/episode picker for series (B3). Client component — real feature
 * request: switching seasons or picking an episode used to be a full page
 * navigation, resetting scroll position every time, and required a
 * separate "select an episode, then find the Play button elsewhere" step.
 * Season filtering is now a pure local-state slice over the full `videos`
 * array (already all in memory — no navigation, no scroll reset, by
 * construction), and each episode row gets its own inline Play button
 * (`onPlayEpisode`) alongside a plain row-select button (`onSelectEpisode`,
 * highlights without playing) — no more two-step flow.
 */
export function EpisodePicker({
  videos,
  selectedVideoId,
  onSelectEpisode,
  onPlayEpisode,
}: {
  videos: StremioVideo[];
  selectedVideoId: string;
  onSelectEpisode: (videoId: string) => void;
  onPlayEpisode: (videoId: string) => void;
}) {
  const seasons = Array.from(new Set(videos.map((video) => video.season ?? 0))).sort((a, b) => a - b);
  const selected = videos.find((video) => video.id === selectedVideoId);
  const [activeSeason, setActiveSeason] = useState(selected?.season ?? seasons[0] ?? 0);

  // Selection can change from OUTSIDE a season-tab click too — e.g.
  // PlaybackControls' own "Next Episode" flow can cross a season boundary
  // without ever touching a season tab. Keep the highlighted tab in sync
  // whenever that happens.
  useEffect(() => {
    const season = videos.find((v) => v.id === selectedVideoId)?.season ?? seasons[0] ?? 0;
    setActiveSeason(season);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVideoId]);

  const episodesInSeason = videos
    .filter((video) => (video.season ?? 0) === activeSeason)
    .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));

  return (
    <section className={styles.wrap} aria-label="Episodes">
      {seasons.length > 1 && (
        <nav aria-label="Seasons" className={styles.seasonRow}>
          {seasons.map((season) => {
            const isActive = season === activeSeason;
            return (
              <button
                key={season}
                type="button"
                onClick={() => setActiveSeason(season)}
                className={isActive ? `${styles.seasonTab} ${styles.seasonTabActive}` : styles.seasonTab}
                aria-current={isActive ? "true" : undefined}
              >
                {season === 0 ? "Specials" : `Season ${season}`}
              </button>
            );
          })}
        </nav>
      )}
      <ul className={styles.episodeList}>
        {episodesInSeason.map((video) => {
          const isActive = video.id === selectedVideoId;
          return (
            <li key={video.id} className={isActive ? `${styles.episodeRow} ${styles.episodeRowActive}` : styles.episodeRow}>
              <button
                type="button"
                className={styles.episodeRowSelect}
                onClick={() => onSelectEpisode(video.id)}
                aria-current={isActive ? "true" : undefined}
              >
                <span className={styles.episodeNumber}>
                  {video.episode != null ? `E${video.episode}` : ""}
                </span>
                <span className={styles.episodeTitle}>
                  {video.title || `Episode ${video.episode ?? ""}`}
                </span>
              </button>
              <button type="button" className={styles.episodeRowPlay} onClick={() => onPlayEpisode(video.id)}>
                Play
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
