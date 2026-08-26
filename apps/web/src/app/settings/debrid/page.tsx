import Link from "next/link";
import { getDebridAccountStatus, getDebridProvider } from "@/lib/debrid-server";
import { DebridConnect } from "./DebridConnect";
import styles from "../settings.module.css";

export default async function DebridSettingsPage() {
  const [account, provider] = await Promise.all([getDebridAccountStatus(), getDebridProvider()]);

  return (
    <>
      <Link href="/settings" className={styles.backLink}>
        &larr; Settings
      </Link>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Debrid</h1>
        <p className={styles.pageDescription}>
          A debrid service resolves cached sources for on-demand streams. Connect whichever one you
          already have an account with — Real-Debrid, AllDebrid, Premiumize, or TorBox.
        </p>
      </div>
      <DebridConnect initialAccount={account} initialProvider={provider} />
    </>
  );
}
