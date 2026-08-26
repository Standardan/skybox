import Link from "next/link";
import { readConfig } from "@/lib/config-store";
import { IptvManager } from "./IptvManager";
import styles from "../settings.module.css";

export default async function IptvSettingsPage() {
  const config = await readConfig();

  return (
    <>
      <Link href="/settings" className={styles.backLink}>
        &larr; Settings
      </Link>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Live TV providers</h1>
        <p className={styles.pageDescription}>
          Enter your Xtream login, or paste an M3U playlist URL with an optional EPG URL. Multiple
          providers are supported.
        </p>
      </div>
      <IptvManager initialProviders={config.iptv} />
    </>
  );
}
