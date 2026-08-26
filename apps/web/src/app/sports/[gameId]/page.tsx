import Link from "next/link";
import { notFound } from "next/navigation";
import { TopNav } from "@/components/TopNav";
import { GameStateChip } from "@/components/GameStateChip";
import { getTodaysMatchedGames } from "@/lib/sports-server";
import { getIptvSnapshot } from "@/lib/iptv-server";
import { readConfig } from "@/lib/config-store";
import { isRequestHttps, needsStreamProxy, proxiedStreamUrl } from "@/lib/stream-proxy";
import { GameWatchPanel, type ChannelMatchView } from "./GameWatchPanel";
import styles from "./page.module.css";

// See apps/web/src/app/live/page.tsx for why.
export const fetchCache = "default-no-store";
// Real, per-viewer, frequently-changing data — never statically prerendered.
export const dynamic = "force-dynamic";

function formatClock(status: "upcoming" | "live" | "final", startTime: number): string {
  if (status === "live") return "LIVE";
  if (status === "final") return "FINAL";
  return new Date(startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * D5 game detail: real matched channels (sorted by confidence — see
 * matchGameToChannels), each one click from playing (via GameWatchPanel).
 * D4 follow-up "not this channel?" lives in GameWatchPanel too.
 */
export default async function GameDetailPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;

  const [games, config, snapshot] = await Promise.all([
    getTodaysMatchedGames(),
    readConfig(),
    getIptvSnapshot(),
  ]);

  const game = games.find((g) => g.id === gameId);
  if (!game) notFound();

  const https = await isRequestHttps();
  const channelById = new Map(snapshot.channels.map((channel) => [channel.id, channel]));
  const matches: ChannelMatchView[] = game.matchedChannels.flatMap((match) => {
    const channel = channelById.get(match.channelId);
    if (!channel) return [];
    return [
      {
        channelId: channel.id,
        channelName: channel.name,
        channelLogo: channel.logo,
        streamUrl: needsStreamProxy(channel.streamUrl, https) ? proxiedStreamUrl(channel.streamUrl) : channel.streamUrl,
        streamFormat: channel.streamFormat,
        confidence: match.confidence,
        reason: match.reason,
      },
    ];
  });

  const showScore = !config.sports.spoilerFree && game.score && (game.status === "live" || game.status === "final");

  return (
    <>
      <TopNav />
      <main className={styles.main}>
        <Link href="/sports" className={styles.back}>
          &larr; Today&rsquo;s Games
        </Link>

        <span className={styles.league}>{game.league.toUpperCase()}</span>
        <h1 className={styles.matchup}>
          {game.away.name}
          <span className={styles.at}>@</span>
          {game.home.name}
        </h1>

        <GameStateChip
          state={game.status}
          clock={formatClock(game.status, game.startTime)}
          score={showScore && game.score ? `${game.score.away}-${game.score.home}` : undefined}
        />

        <GameWatchPanel
          gameId={game.id}
          title={`${game.away.name} @ ${game.home.name}`}
          matches={matches}
          league={game.league}
          homeTeam={game.home.name}
          awayTeam={game.away.name}
        />
      </main>
    </>
  );
}
