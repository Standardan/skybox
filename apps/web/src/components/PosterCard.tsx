import Image from "next/image";
import shared from "./shared.module.css";
import styles from "./PosterCard.module.css";

/**
 * Reference: LT-02 (Netflix) — title stays hidden until focus/hover, art
 * carries the card. Shares the global focus-lift (LT-03, Apple TV).
 */
export function PosterCard({
  title,
  posterUrl,
  progress,
}: {
  title: string;
  posterUrl: string;
  progress?: number;
}) {
  return (
    <button type="button" className={`${styles.card} ${shared.focusLift}`}>
      <div className={styles.art}>
        <Image
          src={posterUrl}
          alt={title}
          fill
          sizes="(max-width: 640px) 40vw, 180px"
          className={styles.image}
        />
        <div className={styles.scrim} aria-hidden="true" />
        <span className={styles.title}>{title}</span>
        {typeof progress === "number" && (
          <div className={styles.progressTrack} aria-hidden="true">
            <div
              className={styles.progressFill}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
      </div>
    </button>
  );
}
