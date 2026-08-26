import Link from "next/link";
import type { StremioVideo } from "@skybox/core/shared";
import styles from "./EpisodePicker.module.css";

/**
 * Season/episode picker for series (B3). Pure server-rendered links that
 * change the `?video=` search param — the title page re-runs its
 * aggregateStreams call server-side (B4) for whichever episode is now
 * selected, so no client JS is needed here at all.
 */
export function EpisodePicker({
  type,
  id,
  videos,
  selectedVideoId,
}: {
  type: string;
  id: string;
  videos: StremioVideo[];
  selectedVideoId: string;
}) {
  const seasons = Array.from(new Set(videos.map((video) => video.season ?? 0))).sort((a, b) => a - b);
  const selected = videos.find((video) => video.id === selectedVideoId);
  const activeSeason = selected?.season ?? seasons[0] ?? 0;

  const episodesInSeason = videos
    .filter((video) => (video.season ?? 0) === activeSeason)
    .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));

  return (
    <section className={styles.wrap} aria-label="Episodes">
      {seasons.length > 1 && (
        <nav aria-label="Seasons" className={styles.seasonRow}>
          {seasons.map((season) => {
            const firstEpisode = videos.find((video) => (video.season ?? 0) === season);
            if (!firstEpisode) return null;
            const isActive = season === activeSeason;
            return (
              <Link
                key={season}
                href={`/title/${type}/${id}?video=${encodeURIComponent(firstEpisode.id)}`}
                className={isActive ? `${styles.seasonTab} ${styles.seasonTabActive}` : styles.seasonTab}
                aria-current={isActive ? "true" : undefined}
              >
                {season === 0 ? "Specials" : `Season ${season}`}
              </Link>
            );
          })}
        </nav>
      )}
      <ul className={styles.episodeList}>
        {episodesInSeason.map((video) => {
          const isActive = video.id === selectedVideoId;
          return (
            <li key={video.id}>
              <Link
                href={`/title/${type}/${id}?video=${encodeURIComponent(video.id)}`}
                className={isActive ? `${styles.episodeRow} ${styles.episodeRowActive}` : styles.episodeRow}
                aria-current={isActive ? "true" : undefined}
              >
                <span className={styles.episodeNumber}>
                  {video.episode != null ? `E${video.episode}` : ""}
                </span>
                <span className={styles.episodeTitle}>
                  {video.title || `Episode ${video.episode ?? ""}`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
