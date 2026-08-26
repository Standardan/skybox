import { redirect } from "next/navigation";
import { readUsers } from "@/lib/user-store";
import { SetupForm } from "./SetupForm";
import styles from "../auth.module.css";

export const dynamic = "force-dynamic";

/** First-run admin creation (D-020). Only reachable while zero accounts exist — once the first admin is created, this redirects to /login like any other visit. */
export default async function SetupPage() {
  const users = await readUsers();
  if (users.length > 0) redirect("/login");

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.logo}>Skybox</p>
        <p className={styles.subtitle}>
          This is a new instance — nobody can sign in yet. Create the admin account. You can add more accounts
          later from Settings.
        </p>
        <SetupForm />
      </div>
    </div>
  );
}
