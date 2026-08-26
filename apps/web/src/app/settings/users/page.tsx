import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readUsers } from "@/lib/user-store";
import { UsersManager } from "./UsersManager";
import styles from "../settings.module.css";

export const dynamic = "force-dynamic";

export default async function UsersSettingsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");
  if (currentUser.role !== "admin") redirect("/settings");

  const users = await readUsers();
  const publicUsers = users
    .map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt }))
    .sort((a, b) => a.createdAt - b.createdAt);

  return (
    <>
      <Link href="/settings" className={styles.backLink}>
        &larr; Settings
      </Link>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Users</h1>
        <p className={styles.pageDescription}>
          Everyone here can sign in and watch — addons, debrid, and IPTV are shared by the whole
          instance, but each person&rsquo;s Continue Watching and favorites are their own. Admins can
          manage users; anyone else can&rsquo;t.
        </p>
      </div>
      <UsersManager initialUsers={publicUsers} currentUserId={currentUser.id} />
    </>
  );
}
