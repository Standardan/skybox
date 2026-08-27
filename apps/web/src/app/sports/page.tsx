import Link from "next/link";
import type { Game } from "@skybox/core/shared";
import { formatClockTime } from "@skybox/core/shared";
import { TopNav } from "@/components/TopNav";
import { Rail } from "@/components/Rail";
import { MediaCard, type MediaCardGame } from "@/components/MediaCard";
import { getTodaysMatchedGames } from "@/lib/sports-server";
import { getIptvSnapshot } from "@/lib/iptv-server";
import { readConfig } from "@/lib/config-store";
import styles from "./page.module.css";

// See apps/web/src/app/live/page.tsx for why: this route also drives the
// same concurrent 13-mirror IPTV fetch (via getTodaysMatchedGames/
// getIptvSnapshot), already cached at the application layer.
export const fetchCache = "default-no-store";
// Real, per-viewer, frequently-changing data — never statically prerendered.
export const dynamic = "force-dynamic";

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

function EmptyState({
  title,
  body,
  showSettingsLink,
}: {
  title: string;
  body: string;
  showSettingsLink?: boolean;
}) {
  return (
    <>
      <TopNav />
      <main className={styles.main}>
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{title}</p>
          <p className={styles.emptyBody}>{body}</p>
          {showSettingsLink && (
            <Link href="/settings" className={styles.emptyLink}>
              Go to Settings
            </Link>
          )}
        </div>
      </main>
    </>
  );
}

/** D3: real Today's Games grouped by league. D8: sports being off is a normal state, not an error. */
export default async function SportsPage() {
  const config = await readConfig();

  if (!config.sports.enabled) {
    return (
      <EmptyState
        title="Sports is turned off"
        body="Turn on sports in Settings to follow leagues and teams and see today's games matched to your channels."
        showSettingsLink
      />
    );
  }

  if (config.sports.leagues.length === 0 && config.sports.teams.length === 0) {
    return (
      <EmptyState
        title="No leagues or teams followed yet"
        body="Follow a league or a team in Settings → Sports to see today's games here."
        showSettingsLink
      />
    );
  }

  const [games, snapshot] = await Promise.all([getTodaysMatchedGames(), getIptvSnapshot()]);

  if (games.length === 0) {
    return (
      <EmptyState
        title="No games today"
        body="Nothing scheduled today for your followed leagues or teams."
      />
    );
  }

  const channelNameById = new Map(snapshot.channels.map((channel) => [channel.id, channel.name]));

  const byLeague = new Map<string, Game[]>();
  for (const game of games) {
    const list = byLeague.get(game.league);
    if (list) list.push(game);
    else byLeague.set(game.league, [game]);
  }

  return (
    <>
      <TopNav />
      <main className={styles.main}>
        <h1 className={styles.heading}>Today&rsquo;s Games</h1>
        {Array.from(byLeague.entries()).map(([league, leagueGames]) => (
          <Rail key={league} title={league.toUpperCase()}>
            {leagueGames.map((game) => (
              <MediaCard
                key={game.id}
                game={toCardGame(game, channelNameById, config.sports.spoilerFree, config.ui.timezone)}
                href={`/sports/${game.id}`}
              />
            ))}
          </Rail>
        ))}
      </main>
    </>
  );
}
