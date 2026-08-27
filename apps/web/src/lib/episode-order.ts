import type { StremioVideo } from "@skybox/core/shared";

/** Regular (season >= 1) episodes, sorted season then episode number. Shared between the title page's server-side initial render and SeriesPlaybackSection's client-side re-selection, so both agree on the same order. */
export function sortedRegularEpisodes(videos: StremioVideo[]): StremioVideo[] {
  return videos
    .filter((video) => (video.season ?? 0) >= 1)
    .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
}

/**
 * The episode strictly after `currentVideoId` in season/episode order, or
 * undefined at the last episode (or if `currentVideoId` isn't a regular
 * episode at all). Used to power background prefetch + the "Next Episode"
 * prompt (PlaybackControls.tsx) — real feature request: "so much time
 * between episodes that I have to sit here and wait for one [source] to
 * work."
 */
export function findNextEpisode(videos: StremioVideo[], currentVideoId: string): StremioVideo | undefined {
  const regular = sortedRegularEpisodes(videos);
  const currentIndex = regular.findIndex((v) => v.id === currentVideoId);
  if (currentIndex === -1 || currentIndex === regular.length - 1) return undefined;
  return regular[currentIndex + 1];
}
