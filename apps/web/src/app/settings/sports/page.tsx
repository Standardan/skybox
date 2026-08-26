import Link from "next/link";
import { readConfig } from "@/lib/config-store";
import { SportsForm } from "./SportsForm";
import styles from "../settings.module.css";

export default async function SportsSettingsPage() {
  const config = await readConfig();

  return (
    <>
      <Link href="/settings" className={styles.backLink}>
        &larr; Settings
      </Link>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Sports</h1>
        <p className={styles.pageDescription}>
          Follow leagues or specific teams. You can hide live scores anytime with the spoiler-free
          toggle below.
        </p>
      </div>
      <SportsForm initialSports={config.sports} />
    </>
  );
}
