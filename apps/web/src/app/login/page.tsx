import { Suspense } from "react";
import { redirect } from "next/navigation";
import { readUsers } from "@/lib/user-store";
import { LoginForm } from "./LoginForm";
import styles from "../auth.module.css";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const users = await readUsers();
  if (users.length === 0) redirect("/setup");

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.logo}>Skybox</p>
        <p className={styles.subtitle}>Sign in to continue.</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
