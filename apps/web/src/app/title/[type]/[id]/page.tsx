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
import { sortedRegularEpisodes } from "@/lib/episode-order";
import { TopNav } from "@/components/TopNav";
import { TitleHero } from "@/components/TitleHero";
import { PlaybackControls } from "@/components/PlaybackControls";
import { SeriesPlaybackSection } from "@/components/SeriesPlaybackSection";
import { WatchlistToggle } from "@/components/WatchlistToggle";
import styles from "./title.module.css";

// Real, live Cinemeta/addon/debrid-connection data — never statically
// prerendered (and IDs are unbounded/user-driven, so build-time generation
// isn't meaningful here anyway).
export const dynamic = "force-dynamic";

/** First regular episode (season >= 1) in season/episode order, else the first video at all. */
function pickDefaultVideoId(videos: StremioVideo[]): string | undefined {
  const regular = sortedRegularEpisodes(videos);
  return (regular[0] ?? videos[0])?.id;
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

  // Cinemeta's runtime applies per-episode for a series too, not just
  // movies — same field either way. Used to catch a resolved source
  // that's actually just a trailer (see Player.tsx's onLikelyTrailer).
  const expectedRuntimeMinutes = parseRuntimeMinutes(meta.runtime) ?? undefined;

  return (
    <>
      <TopNav />
      <main>
        {isSeries ? (
          <SeriesPlaybackSection
            // Keyed by the SHOW's id, not the episode — SeriesPlaybackSection
            // deliberately owns episode selection as internal state precisely
            // so switching episodes does NOT remount it (that's the whole
            // point of it existing). But if this page is ever reached via a
            // same-route client-side navigation to a DIFFERENT show (e.g. a
            // future "More like this" link), only a changing key forces the
            // fresh mount that show genuinely needs — see onNextEpisode's doc
            // comment in PlaybackControls.tsx for the real bug this class of
            // stale-state issue already caused for "Next Episode".
            key={id}
            type={type}
            metaId={id}
            mediaType={type as MediaType}
            backgroundUrl={cinemetaBackgroundUrl(id)}
            title={meta.name}
            meta={metaLine || undefined}
            synopsis={meta.description}
            poster={meta.poster}
            videos={meta.videos!}
            initialVideoId={currentVideoId}
            initialStreams={streams}
            hasAddons={streamAddons.length > 0}
            playbackPrefs={config.playback}
            expectedRuntimeMinutes={expectedRuntimeMinutes}
            libraryProgress={libraryItem?.progress}
            lastWorkingSource={libraryItem?.lastWorkingSource}
            autoPlayOnMount={autoplay === "1"}
            watchlistToggle={
              <WatchlistToggle
                metaId={id}
                type={type as MediaType}
                initialOnWatchlist={libraryItem?.state === "watchlist"}
              />
            }
          />
        ) : (
          <TitleHero
            backgroundUrl={cinemetaBackgroundUrl(id)}
            title={meta.name}
            meta={metaLine || undefined}
            synopsis={meta.description}
            actions={
              <>
                <PlaybackControls
                  key="playback-controls"
                  streams={streams}
                  hasAddons={streamAddons.length > 0}
                  title={meta.name}
                  poster={meta.poster}
                  metaId={id}
                  mediaType={type as MediaType}
                  videoId={currentVideoId}
                  playbackPrefs={config.playback}
                  resumePositionSec={resumePositionSec}
                  expectedRuntimeMinutes={expectedRuntimeMinutes}
                  lastWorkingSource={libraryItem?.lastWorkingSource}
                  autoPlayOnMount={autoplay === "1"}
                />
                <WatchlistToggle
                  key="watchlist-toggle"
                  metaId={id}
                  type={type as MediaType}
                  initialOnWatchlist={libraryItem?.state === "watchlist"}
                />
              </>
            }
          />
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
