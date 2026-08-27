import { redirect } from "next/navigation";
import { getContinueWatching, getWatchlist } from "@skybox/core/library";
import type { AddonRef, Game } from "@skybox/core/shared";
import { formatClockTime } from "@skybox/core/shared";
import { TopNav } from "@/components/TopNav";
import { TimezoneAutoDetect } from "@/components/TimezoneAutoDetect";
import { Rail } from "@/components/Rail";
import { MediaCard, type MediaCardGame } from "@/components/MediaCard";
import { PosterCardLink } from "@/components/PosterCardLink";
import { ContinueWatchingRail } from "@/components/ContinueWatchingRail";
import { getCinemetaAddon, getCachedCatalog } from "@/lib/addon-server";
import { cinemetaPosterUrl } from "@/lib/cinemeta";
import { resolveLibraryCards, type LibraryCard } from "@/lib/library-cards";
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

function formatClock(game: Game, timezone: string): string {
  if (game.status === "live") return "LIVE";
  if (game.status === "final") return "FINAL";
  return formatClockTime(game.startTime, timezone);
}

function formatScore(game: Game, spoilerFree: boolean): string | undefined {
  if (spoilerFree || !game.score) return undefined;
  if (game.status !== "live" && game.status !== "final") return undefined;
  return `${game.score.away}-${game.score.home}`;
}

function toCardGame(
  game: Game,
  channelNameById: Map<string, string>,
  spoilerFree: boolean,
  timezone: string,
): MediaCardGame {
  const topMatch = game.matchedChannels[0];
  const channel = topMatch ? channelNameById.get(topMatch.channelId) : undefined;
  return {
    id: game.id,
    league: game.league.toUpperCase(),
    home: game.home.name,
    away: game.away.name,
    state: game.status,
    clock: formatClock(game, timezone),
    channel: channel ?? "No channel match",
    score: formatScore(game, spoilerFree),
  };
}

const HOME_GAMES_LIMIT = 8;
const HOME_RAIL_LIMIT = 12;
const CONTINUE_WATCHING_LIMIT = 12;
const WATCHLIST_RAIL_LIMIT = 12;

async function loadContinueWatching(cinemeta: AddonRef, userId: string): Promise<LibraryCard[]> {
  const library = await readLibrary(userId);
  const items = getContinueWatching(library, CONTINUE_WATCHING_LIMIT);
  return resolveLibraryCards(cinemeta, items);
}

/** My List (B9). */
async function loadWatchlist(cinemeta: AddonRef, userId: string): Promise<LibraryCard[]> {
  const library = await readLibrary(userId);
  const items = getWatchlist(library).slice(0, WATCHLIST_RAIL_LIMIT);
  return resolveLibraryCards(cinemeta, items);
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

  const [popularMovies, popularSeries, continueWatching, watchlist] = await Promise.all([
    getCachedCatalog(cinemeta, "movie", CATALOG_ID),
    getCachedCatalog(cinemeta, "series", CATALOG_ID),
    loadContinueWatching(cinemeta, user.id),
    loadWatchlist(cinemeta, user.id),
  ]);

  // D8: sports off, no leagues followed, or nothing scheduled today — the
  // rail is simply absent, not an empty-state block competing with the
  // rest of Home.
  let todaysGames: MediaCardGame[] = [];
  if (sportsResult) {
    const [games, snapshot] = sportsResult;
    const channelNameById = new Map(snapshot.channels.map((c) => [c.id, c.name]));
    todaysGames = games
      .slice(0, HOME_GAMES_LIMIT)
      .map((game) => toCardGame(game, channelNameById, config.sports.spoilerFree, config.ui.timezone));
  }

  return (
    <>
      <TimezoneAutoDetect currentTimezone={config.ui.timezone} />
      <TopNav />
      <main>
        {todaysGames.length > 0 && (
          <Rail title="Today's Games">
            {todaysGames.map((game) => (
              <MediaCard key={game.id} game={game} href={`/sports/${game.id}`} />
            ))}
          </Rail>
        )}

        {continueWatching.length > 0 && <ContinueWatchingRail items={continueWatching} />}

        {watchlist.length > 0 && (
          <Rail title="My List">
            {watchlist.map((item) => (
              <PosterCardLink key={item.id} href={item.href} title={item.title} posterUrl={item.posterUrl} />
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
