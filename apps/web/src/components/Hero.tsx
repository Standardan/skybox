import Image from "next/image";
import Link from "next/link";
import styles from "./Hero.module.css";

export interface HeroData {
  title: string;
  synopsis: string;
  posterUrl: string;
  backdropUrl: string;
  /** Where "Play"/"More info" navigate — omit to render them inert (rare). */
  href?: string;
}

/**
 * Reference: LT-02 (Netflix) — full-bleed artwork under a bottom-weighted
 * dark scrim, near-zero chrome, oversized confident title type. `demo` shows
 * the on-screen label the Asset Readiness Gate requires for placeholder
 * data; omit it once the hero is backed by a real source.
 */
export function Hero({ data, demo }: { data: HeroData; demo?: boolean }) {
  return (
    <section className={styles.hero} aria-label="Featured title">
      <Image
        src={data.backdropUrl}
        alt=""
        fill
        priority
        sizes="100vw"
        className={styles.backdrop}
      />
      <div className={styles.scrim} aria-hidden="true" />
      <div className={styles.content}>
        {demo && <span className={styles.demoLabel}>Demo data</span>}
        <h1 className={styles.title}>{data.title}</h1>
        <p className={styles.synopsis}>{data.synopsis}</p>
        <div className={styles.actions}>
          {data.href ? (
            <>
              <Link href={data.href} className={styles.primary}>
                Play
              </Link>
              <Link href={data.href} className={styles.secondary}>
                More info
              </Link>
            </>
          ) : (
            <>
              <button type="button" className={styles.primary}>
                Play
              </button>
              <button type="button" className={styles.secondary}>
                More info
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
