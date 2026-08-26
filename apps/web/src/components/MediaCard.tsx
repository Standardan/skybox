import Link from "next/link";
import type { GameState } from "@/lib/demo-data";
import { GameStateChip } from "./GameStateChip";
import shared from "./shared.module.css";
import styles from "./MediaCard.module.css";

/**
 * Shape MediaCard needs to render. `DemoGame` (Home page's demo data)
 * satisfies this structurally, so existing Home usage keeps working
 * unchanged — `posterUrl` and `score` are optional here even though
 * `DemoGame.posterUrl` is required there.
 */
export interface MediaCardGame {
  id: string;
  league: string;
  home: string;
  away: string;
  state: GameState;
  clock: string;
  channel: string;
  posterUrl?: string;
  /** Formatted score, e.g. "24-17" (D6) — omit to hide (spoiler-free). */
  score?: string;
}

/**
 * 16:9 game/channel card. Reference: LT-03 (Apple TV) focus-lift, shared
 * with PosterCard; state chip stays always-visible (not hover-revealed),
 * per §8 — distinct from PosterCard's title-on-focus behavior.
 *
 * No fabricated photographic art for fictional demo matchups (Asset
 * Readiness Gate) — real sports broadcast graphics are typographic before
 * kickoff, so a typographic card is the honest representative treatment.
 *
 * Pass `href` to navigate (e.g. to a game detail page) — renders as a link
 * instead of a button so there's no nested-interactive-element a11y issue.
 */
export function MediaCard({ game, href }: { game: MediaCardGame; href?: string }) {
  const content = (
    <>
      <span className={styles.league}>{game.league}</span>
      <span className={styles.matchup}>
        {game.away}
        <span className={styles.at}>@</span>
        {game.home}
      </span>
      <span className={styles.footer}>
        <GameStateChip state={game.state} clock={game.clock} score={game.score} />
        <span className={styles.channel}>{game.channel}</span>
      </span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`${styles.card} ${shared.focusLift}`}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={`${styles.card} ${shared.focusLift}`}>
      {content}
    </button>
  );
}
