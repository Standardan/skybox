import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { UpdateStatus } from "./UpdateStatus";
import styles from "../settings.module.css";

export const dynamic = "force-dynamic";

export default async function UpdatesSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/settings");

  return (
    <>
      <Link href="/settings" className={styles.backLink}>
        &larr; Settings
      </Link>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Updates</h1>
        <p className={styles.pageDescription}>
          Skybox never updates itself automatically — this only checks GitHub and tells you when
          something&rsquo;s new. Applying it still needs a click from you.
        </p>
      </div>
      <UpdateStatus />
    </>
  );
}
