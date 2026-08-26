import Link from "next/link";
import { readConfig } from "@/lib/config-store";
import { PlaybackForm } from "./PlaybackForm";
import styles from "../settings.module.css";

/**
 * Quality-bias preference is real (see `PlaybackForm`/`actions.ts` and
 * `PlaybackControls.tsx`'s `applyPlaybackPrefs`). Subtitle style is not —
 * there's no subtitle track support anywhere in the Player yet (F2 in
 * docs/02-REQUIREMENTS.md), so a "style" control for a feature that
 * doesn't exist would be misleading regardless of whether it persists.
 * Said plainly below instead of a fake toggle.
 */
export default async function PlaybackSettingsPage() {
  const config = await readConfig();

  return (
    <>
      <Link href="/settings" className={styles.backLink}>
        &larr; Settings
      </Link>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Playback</h1>
        <p className={styles.pageDescription}>
          Choose how Skybox picks the best source when a title has more than one.
        </p>
      </div>

      <PlaybackForm initialPrefs={config.playback} />

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Subtitles</h2>
        <div className={styles.stub}>
          <p>Subtitle tracks aren&apos;t supported in the player yet, so there&apos;s no style to set.</p>
        </div>
      </section>
    </>
  );
}
