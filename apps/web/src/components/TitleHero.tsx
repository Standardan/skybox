import Image from "next/image";
import type { ReactNode } from "react";
import styles from "./TitleHero.module.css";

/**
 * Title detail hero. Carries the same LT-02 (Netflix) visual silhouette as
 * Hero.tsx — full-bleed backdrop, bottom-weighted scrim, oversized title,
 * minimal chrome — as its own component (rather than reusing Hero.tsx
 * directly) since its data shape (real Cinemeta meta, not Home's demo
 * data) and its `actions` slot (playback controls, not static buttons) are
 * genuinely different props than Hero.tsx's Home-specific shape.
 */
export function TitleHero({
  backgroundUrl,
  title,
  meta,
  synopsis,
  actions,
}: {
  backgroundUrl?: string;
  title: string;
  meta?: string;
  synopsis?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={styles.hero} aria-label={title}>
      {backgroundUrl && (
        <Image
          src={backgroundUrl}
          alt=""
          fill
          priority
          sizes="100vw"
          className={styles.backdrop}
        />
      )}
      <div className={styles.scrim} aria-hidden="true" />
      <div className={styles.content}>
        <h1 className={styles.title}>{title}</h1>
        {meta && <p className={styles.meta}>{meta}</p>}
        {synopsis && <p className={styles.synopsis}>{synopsis}</p>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </section>
  );
}
