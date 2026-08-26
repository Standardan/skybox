import Link from "next/link";
import { readConfig } from "@/lib/config-store";
import { HomeRailsForm } from "./HomeRailsForm";
import styles from "../settings.module.css";

export default async function HomeSettingsPage() {
  const config = await readConfig();

  return (
    <>
      <Link href="/settings" className={styles.backLink}>
        &larr; Settings
      </Link>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Home screen</h1>
        <p className={styles.pageDescription}>
          Reorder or hide rails on the Home screen, and choose whether Today&apos;s Games is pinned
          on top.
        </p>
      </div>
      <HomeRailsForm initialUi={config.ui} />
    </>
  );
}
