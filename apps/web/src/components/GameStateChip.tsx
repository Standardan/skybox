import type { GameState } from "@/lib/demo-data";
import styles from "./GameStateChip.module.css";

/**
 * Reference: LT-05 (ESPN) — extreme font-weight contrast at small, dense
 * scale, not a large condensed numeral. Lineage: beUI `animated-badge`
 * (pulse-on-live), adapted into Oswald third-voice type per
 * DESIGN-BRIEF.md §8.
 */
export function GameStateChip({
  state,
  clock,
  score,
}: {
  state: GameState;
  clock: string;
  /** Formatted score, e.g. "24-17" (D6). Omit to show state/time only. */
  score?: string;
}) {
  return (
    <span className={`${styles.chip} ${styles[state]}`}>
      {state === "live" && <span className={styles.dot} aria-hidden="true" />}
      {clock}
      {score && <span className={styles.score}>{score}</span>}
    </span>
  );
}
