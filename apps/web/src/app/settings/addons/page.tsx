import Link from "next/link";
import { readConfig } from "@/lib/config-store";
import { AddonManager } from "./AddonManager";
import styles from "../settings.module.css";

export default async function AddonsSettingsPage() {
  const config = await readConfig();
  const addons = [...config.addons].sort((a, b) => a.order - b.order);

  return (
    <>
      <Link href="/settings" className={styles.backLink}>
        &larr; Settings
      </Link>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Addons</h1>
        <p className={styles.pageDescription}>
          Paste a manifest URL from any Stremio-compatible addon you already use. Skybox doesn&apos;t
          bundle or recommend any addon sources.
        </p>
      </div>
      <AddonManager initialAddons={addons} />
    </>
  );
}
