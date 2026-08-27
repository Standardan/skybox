import Image from "next/image";
import shared from "./shared.module.css";
import styles from "./PosterCard.module.css";

/**
 * Reference: LT-02 (Netflix) — title stays hidden until focus/hover, art
 * carries the card. Shares the global focus-lift (LT-03, Apple TV).
 *
 * Real feature request: a way to dismiss a Continue Watching / history
 * item directly from its card. The whole card used to be one `<button>` —
 * a dismiss control can't nest inside it (invalid HTML, and it'd double as
 * the navigate target), so the outer `.card` is now a plain wrapper div
 * hosting two siblings: `.selectButton` (the original button, now scoped to
 * just the art/title/progress) and an optional `.dismissButton`. Only
 * rendered when `onDismiss` is passed — every other caller (Popular
 * Movies/Series, etc.) is unaffected.
 */
export function PosterCard({
  title,
  posterUrl,
  progress,
  onDismiss,
  dismissLabel,
}: {
  title: string;
  posterUrl: string;
  progress?: number;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  return (
    <div className={styles.card}>
      <button type="button" className={`${styles.selectButton} ${shared.focusLift}`}>
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
      {onDismiss && (
        <button
          type="button"
          className={styles.dismissButton}
          onClick={(e) => {
            // Otherwise this bubbles into PosterCardLink's outer
            // onClick={() => router.push(href)} and navigates instead.
            e.stopPropagation();
            onDismiss();
          }}
          aria-label={dismissLabel ?? `Remove ${title}`}
        >
          ×
        </button>
      )}
    </div>
  );
}
