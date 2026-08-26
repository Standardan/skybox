import type { ReactNode } from "react";
import styles from "./Rail.module.css";

/**
 * Reference: LT-02 (Netflix) silhouette — spacious rail rhythm. Entrance
 * lineage: beUI `scroll-reveal` (viewport-triggered, staggered), adapted to
 * the brief's exact 220ms/40ms values. See DESIGN-BRIEF.md §7, §8.
 */
export function Rail({ title, children }: { title: string; children: ReactNode[] }) {
  return (
    <section className={styles.rail} aria-label={title}>
      <h2 className={styles.heading}>{title}</h2>
      <ul className={styles.track}>
        {children.map((child, i) => (
          <li key={i} className={styles.item} style={{ "--i": i } as React.CSSProperties}>
            {child}
          </li>
        ))}
      </ul>
    </section>
  );
}
