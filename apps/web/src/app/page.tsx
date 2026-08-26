import { redirect } from "next/navigation";
import { getMeta } from "@skybox/core/addon-client";
import { getContinueWatching } from "@skybox/core/library";
import type { AddonRef, Game } from "@skybox/core/shared";
import { TopNav } from "@/components/TopNav";
import { Hero } from "@/components/Hero";
import { Rail } from "@/components/Rail";
import { MediaCard, type MediaCardGame } from "@/components/MediaCard";
import { PosterCardLink } from "@/components/PosterCardLink";
import { getCinemetaAddon, getCachedCatalog } from "@/lib/addon-server";
import { cinemetaPosterUrl, cinemetaBackgroundUrl } from "@/lib/cinemeta";
import { getTodaysMatchedGames } from "@/lib/sports-server";
import { getIptvSnapshot } from "@/lib/iptv-server";
import { readConfig } from "@/lib/config-store";
import { readLibrary } from "@/lib/library-store";
import { getCurrentUser } from "@/lib/session";

// See apps/web/src/app/live/page.tsx for why: Home also triggers the same
// concurrent 13-mirror IPTV fetch via getTodaysMatchedGames when sports is
// enabled, already cached at the application layer.
export const fetchCache = "default-no-store";
// Real, per-viewer, frequently-changing data (live channels/EPG/scores,
// the user's own config) — never statically prerendered at build time.
export const dynamic = "force-dynamic";

const CATALOG_ID = "top"; // confirmed against Cinemeta's live manifest — see CatalogBrowse.tsx

function formatClock(game: Game): string {
  if (game.status === "live") return "LIVE";
  if (game.status === "final") return "FINAL";
  return new Date(game.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatScore(game: Game, spoilerFree: boolean): string | undefined {
  if (spoilerFree || !game.score) return undefined;
  if (game.status !== "live" && game.status !== "final") return undefined;
  return `${game.score.away}-${game.score.home}`;
}

function toCardGame(game: Game, channelNameById: Map<string, string>, spoilerFree: boolean): MediaCardGame {
  const topMatch = game.matchedChannels[0];
  const channel = topMatch ? channelNameById.get(topMatch.channelId) : undefined;
  return {
    id: game.id,
    league: game.league.toUpperCase(),
    home: game.home.name,
    away: game.away.name,
    state: game.status,
    clock: formatClock(game),
    channel: channel ?? "No channel match",
    score: formatScore(game, spoilerFree),
  };
}

const HOME_GAMES_LIMIT = 8;
const HOME_RAIL_LIMIT = 12;
const CONTINUE_WATCHING_LIMIT = 12;

interface ContinueWatchingCard {
  id: string;
  title: string;
  posterUrl: string;
  progress: number;
  href: string;
}

/**
 * `LibraryItem` only stores ids/progress (packages/core/library is
 * metadata-agnostic on purpose), so each in-progress item needs a real
 * Cinemeta lookup for its name/poster. Movie/series only — a "channel" type
 * would mean live TV, which has no meaningful "continue watching" concept.
 */
async function loadContinueWatching(cinemeta: AddonRef, userId: string): Promise<ContinueWatchingCard[]> {
  const library = await readLibrary(userId);
  const items = getContinueWatching(library, CONTINUE_WATCHING_LIMIT).filter(
    (item) => item.type === "movie" || item.type === "series",
  );

  const cards = await Promise.all(
    items.map(async (item): Promise<ContinueWatchingCard | null> => {
      if (!item.progress) return null;
      try {
        const meta = await getMeta(cinemeta, item.type, item.metaId);
        const resumeVideo = item.progress.videoId !== item.metaId ? `?video=${item.progress.videoId}` : "";
        return {
          id: item.metaId,
          title: meta.name,
          posterUrl: cinemetaPosterUrl(item.metaId),
          progress: Math.min(1, Math.max(0, item.progress.positionSec / item.progress.durationSec)),
          href: `/title/${item.type}/${item.metaId}${resumeVideo}`,
        };
      } catch {
        // A title that's since disappeared from Cinemeta shouldn't break the rail.
        return null;
      }
    }),
  );

  return cards.filter((card): card is ContinueWatchingCard => card !== null);
}

export default async function HomePage() {
  // Middleware already requires a valid session cookie to reach this page —
  // this only re-fails if the account behind it was deleted mid-session.
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const config = await readConfig();

  const [cinemeta, sportsResult] = await Promise.all([
    getCinemetaAddon(),
    config.sports.enabled && (config.sports.leagues.length > 0 || config.sports.teams.length > 0)
      ? Promise.all([getTodaysMatchedGames(), getIptvSnapshot()])
      : Promise.resolve(null),
  ]);

  const [popularMovies, popularSeries, continueWatching] = await Promise.all([
    getCachedCatalog(cinemeta, "movie", CATALOG_ID),
    getCachedCatalog(cinemeta, "series", CATALOG_ID),
    loadContinueWatching(cinemeta, user.id),
  ]);

  const featured = popularMovies[0];

  // D8: sports off, no leagues followed, or nothing scheduled today — the
  // rail is simply absent, not an empty-state block competing with the
  // rest of Home.
  let todaysGames: MediaCardGame[] = [];
  if (sportsResult) {
    const [games, snapshot] = sportsResult;
    const channelNameById = new Map(snapshot.channels.map((c) => [c.id, c.name]));
    todaysGames = games
      .slice(0, HOME_GAMES_LIMIT)
      .map((game) => toCardGame(game, channelNameById, config.sports.spoilerFree));
  }

  return (
    <>
      <TopNav />
      <main>
        {featured && (
          <Hero
            data={{
              title: featured.name,
              synopsis: featured.description ?? "",
              posterUrl: cinemetaPosterUrl(featured.id),
              backdropUrl: featured.background ?? cinemetaBackgroundUrl(featured.id),
              href: `/title/movie/${featured.id}`,
            }}
          />
        )}

        {todaysGames.length > 0 && (
          <Rail title="Today's Games">
            {todaysGames.map((game) => (
              <MediaCard key={game.id} game={game} href={`/sports/${game.id}`} />
            ))}
          </Rail>
        )}

        {continueWatching.length > 0 && (
          <Rail title="Continue Watching">
            {continueWatching.map((item) => (
              <PosterCardLink
                key={item.id}
                href={item.href}
                title={item.title}
                posterUrl={item.posterUrl}
                progress={item.progress}
              />
            ))}
          </Rail>
        )}

        {popularMovies.length > 0 && (
          <Rail title="Popular Movies">
            {popularMovies.slice(0, HOME_RAIL_LIMIT).map((item) => (
              <PosterCardLink
                key={item.id}
                href={`/title/movie/${item.id}`}
                title={item.name}
                posterUrl={cinemetaPosterUrl(item.id)}
              />
            ))}
          </Rail>
        )}

        {popularSeries.length > 0 && (
          <Rail title="Popular Series">
            {popularSeries.slice(0, HOME_RAIL_LIMIT).map((item) => (
              <PosterCardLink
                key={item.id}
                href={`/title/series/${item.id}`}
                title={item.name}
                posterUrl={cinemetaPosterUrl(item.id)}
              />
            ))}
          </Rail>
        )}
      </main>
    </>
  );
}
