import Link from "next/link";
import { ImportForm } from "./ImportForm";
import styles from "../settings.module.css";

/**
 * Deliberately no cross-device sync feature — this is a design decision,
 * not a gap. Skybox is meant to be self-hosted per person: each instance
 * (and everyone who deploys their own) holds only its own owner's
 * credentials and watch history, with no central server anywhere in the
 * picture that could see or store them on anyone's behalf. Multiple
 * devices on the *same* running instance already share state automatically
 * (there's only one config/library file); moving state between two
 * separate self-hosted instances is a manual export/import, on purpose.
 */
export default function SyncSettingsPage() {
  return (
    <>
      <Link href="/settings" className={styles.backLink}>
        &larr; Settings
      </Link>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Devices &amp; Sync</h1>
        <p className={styles.pageDescription}>
          Every device that reaches this same running instance already shares the same watch
          progress and settings automatically — nothing to link. Moving your setup to a
          <em> different</em> self-hosted instance is a manual export/import below, so your
          credentials never pass through anyone else&apos;s server.
        </p>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Export</h2>
        <div className={styles.panelPadded}>
          <p className={styles.fieldHint} style={{ marginBottom: "var(--space-3)" }}>
            Download your full configuration — addons, debrid connection, Live TV providers,
            and preferences — as a JSON file.
          </p>
          <a href="/api/settings/export" download="skybox-config.json" className={styles.buttonPrimary}>
            Download config
          </a>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Import</h2>
        <ImportForm />
      </section>
    </>
  );
}
