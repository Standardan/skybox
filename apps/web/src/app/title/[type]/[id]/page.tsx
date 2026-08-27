import { notFound, redirect } from "next/navigation";
import { aggregateStreams } from "@skybox/core/addon-client";
import { findItem } from "@skybox/core/library";
import type { MediaType, StremioMeta, StremioVideo } from "@skybox/core/shared";
import { parseRuntimeMinutes } from "@skybox/core/shared";
import { getCinemetaAddon, getStreamAddons, getCachedMeta } from "@/lib/addon-server";
import { cinemetaBackgroundUrl } from "@/lib/cinemeta";
import { readConfig } from "@/lib/config-store";
import { readLibrary } from "@/lib/library-store";
import { getCurrentUser } from "@/lib/session";
import { TopNav } from "@/components/TopNav";
import { TitleHero } from "@/components/TitleHero";
import { EpisodePicker } from "@/components/EpisodePicker";
import { PlaybackControls } from "@/components/PlaybackControls";
import { WatchlistToggle } from "@/components/WatchlistToggle";
import styles from "./title.module.css";

// Real, live Cinemeta/addon/debrid-connection data — never statically
// prerendered (and IDs are unbounded/user-driven, so build-time generation
// isn't meaningful here anyway).
export const dynamic = "force-dynamic";

function sortedRegularEpisodes(videos: StremioVideo[]): StremioVideo[] {
  return videos
    .filter((video) => (video.season ?? 0) >= 1)
    .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
}

/** First regular episode (season >= 1) in season/episode order, else the first video at all. */
function pickDefaultVideoId(videos: StremioVideo[]): string | undefined {
  const regular = sortedRegularEpisodes(videos);
  return (regular[0] ?? videos[0])?.id;
}

/**
 * The episode strictly after `currentVideoId` in season/episode order, or
 * undefined at the last episode (or if `currentVideoId` isn't a regular
 * episode at all). Used only to power background prefetch + a "Next
 * Episode" prompt — real feature request: "so much time between episodes
 * that I have to sit here and wait for one [source] to work."
 */
function findNextEpisode(videos: StremioVideo[], currentVideoId: string): StremioVideo | undefined {
  const regular = sortedRegularEpisodes(videos);
  const currentIndex = regular.findIndex((v) => v.id === currentVideoId);
  if (currentIndex === -1 || currentIndex === regular.length - 1) return undefined;
  return regular[currentIndex + 1];
}

export default async function TitlePage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string; id: string }>;
  searchParams: Promise<{ video?: string; autoplay?: string }>;
}) {
  const { type, id } = await params;
  const { video, autoplay } = await searchParams;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const cinemeta = await getCinemetaAddon();

  let meta: StremioMeta;
  try {
    meta = await getCachedMeta(cinemeta, type, id);
  } catch {
    notFound();
  }

  const [streamAddons, config, library] = await Promise.all([getStreamAddons(), readConfig(), readLibrary(user.id)]);
  const libraryItem = findItem(library, id);

  const isSeries = type === "series" && Array.isArray(meta.videos) && meta.videos.length > 0;
  const currentVideoId = isSeries
    ? (video && meta.videos!.some((v) => v.id === video) ? video : undefined) ??
      // No explicit ?video= — prefer resuming whatever's actually in progress over always defaulting to the first episode.
      (libraryItem?.progress && meta.videos!.some((v) => v.id === libraryItem.progress!.videoId)
        ? libraryItem.progress.videoId
        : pickDefaultVideoId(meta.videos!)) ??
      id
    : id;

  // Only resume into a saved position if it's actually for the video
  // being played right now — picking a different episode than the one
  // progress was recorded against should start fresh, not seek randomly.
  const resumePositionSec =
    libraryItem?.progress && libraryItem.progress.videoId === currentVideoId
      ? libraryItem.progress.positionSec
      : undefined;

  // B4: query the user's own stream-providing addons (Torrentio-style) —
  // separate from Cinemeta, which never provides streams. Starts empty on
  // a fresh install; that honest empty state is handled inside
  // PlaybackControls rather than faking a source.
  const streams =
    streamAddons.length > 0 ? await aggregateStreams(streamAddons, type, currentVideoId) : [];

  const metaLine = [
    meta.releaseInfo,
    meta.runtime,
    meta.imdbRating ? `IMDb ${meta.imdbRating}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  const currentEpisode = isSeries ? meta.videos!.find((v) => v.id === currentVideoId) : undefined;
  const nextEpisode = isSeries ? findNextEpisode(meta.videos!, currentVideoId) : undefined;
  const playerTitle =
    isSeries && currentEpisode?.title ? `${meta.name} · ${currentEpisode.title}` : meta.name;
  // Cinemeta's runtime applies per-episode for a series too, not just
  // movies — same field either way. Used to catch a resolved source
  // that's actually just a trailer (see Player.tsx's onLikelyTrailer).
  const expectedRuntimeMinutes = parseRuntimeMinutes(meta.runtime) ?? undefined;

  return (
    <>
      <TopNav />
      <main>
        <TitleHero
          backgroundUrl={cinemetaBackgroundUrl(id)}
          title={meta.name}
          meta={metaLine || undefined}
          synopsis={meta.description}
          actions={
            <>
              <PlaybackControls
                streams={streams}
                hasAddons={streamAddons.length > 0}
                title={playerTitle}
                poster={meta.poster}
                metaId={id}
                mediaType={type as MediaType}
                videoId={currentVideoId}
                playbackPrefs={config.playback}
                resumePositionSec={resumePositionSec}
                expectedRuntimeMinutes={expectedRuntimeMinutes}
                lastWorkingSource={libraryItem?.lastWorkingSource}
                nextVideoId={nextEpisode?.id}
                nextEpisodeLabel={nextEpisode?.title || (nextEpisode ? `Episode ${nextEpisode.episode ?? ""}` : undefined)}
                autoPlayOnMount={autoplay === "1"}
              />
              <WatchlistToggle
                metaId={id}
                type={type as MediaType}
                initialOnWatchlist={libraryItem?.state === "watchlist"}
              />
            </>
          }
        />
        {isSeries && (
          <EpisodePicker type={type} id={id} videos={meta.videos!} selectedVideoId={currentVideoId} />
        )}
        {(meta.genres?.length || meta.cast?.length || meta.director?.length) && (
          <section className={styles.about} aria-label="About">
            {meta.genres?.length ? (
              <p className={styles.aboutRow}>
                <strong>Genres </strong>
                {meta.genres.join(", ")}
              </p>
            ) : null}
            {meta.cast?.length ? (
              <p className={styles.aboutRow}>
                <strong>Cast </strong>
                {meta.cast.join(", ")}
              </p>
            ) : null}
            {meta.director?.length ? (
              <p className={styles.aboutRow}>
                <strong>Director </strong>
                {meta.director.join(", ")}
              </p>
            ) : null}
          </section>
        )}
      </main>
    </>
  );
}
