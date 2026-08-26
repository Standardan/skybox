"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "../auth.module.css";

export function SetupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");

    if (username.length < 2) {
      setError("Username must be at least 2 characters.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create the admin account.");
        setSubmitting(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {error ? <p className={styles.errorText}>{error}</p> : null}
      <div className={styles.field}>
        <label htmlFor="username" className={styles.fieldLabel}>
          Username
        </label>
        <input id="username" name="username" type="text" autoComplete="username" className={styles.input} required />
      </div>
      <div className={styles.field}>
        <label htmlFor="password" className={styles.fieldLabel}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          className={styles.input}
          required
          minLength={8}
        />
      </div>
      <button type="submit" className={styles.buttonPrimary} disabled={submitting}>
        {submitting ? "Creating admin account…" : "Create admin account"}
      </button>
    </form>
  );
}
