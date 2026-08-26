"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@skybox/core/shared";
import styles from "../settings.module.css";

interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  createdAt: number;
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function UsersManager({
  initialUsers,
  currentUserId,
}: {
  initialUsers: PublicUser[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const lastAdminId = users.filter((u) => u.role === "admin").length === 1 ? users.find((u) => u.role === "admin")?.id : null;

  async function addUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const role = String(form.get("role") ?? "member") as UserRole;

    setSubmitting(true);
    try {
      const res = await fetch("/api/settings/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create that user.");
        setSubmitting(false);
        return;
      }
      setUsers((prev) => [...prev, data.user]);
      e.currentTarget.reset();
      setSubmitting(false);
    } catch {
      setError("Could not reach the server. Try again.");
      setSubmitting(false);
    }
  }

  async function deleteUser(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/settings/users/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not remove that user.");
        return;
      }
      setUsers((prev) => prev.filter((u) => u.id !== id));
      if (id === currentUserId) router.push("/login");
    } catch {
      setError("Could not reach the server. Try again.");
    }
  }

  return (
    <>
      {error ? (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      ) : null}

      <ul className={styles.indexList} style={{ marginBottom: "var(--space-8)" }}>
        {users.map((u) => (
          <li key={u.id} className={styles.indexLink} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <span className={styles.indexLinkTitle}>
                {u.username}
                {u.id === currentUserId ? " (you)" : ""}
              </span>
              <span className={styles.indexLinkHint}>
                {u.role === "admin" ? "Admin" : "Member"} &middot; joined {formatDate(u.createdAt)}
              </span>
            </div>
            <button
              type="button"
              className={`${styles.buttonGhost} ${styles.danger}`}
              disabled={u.id === lastAdminId}
              title={u.id === lastAdminId ? "Can't remove the last admin" : undefined}
              onClick={() => deleteUser(u.id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <section className={styles.panelPadded}>
        <p className={styles.fieldLabel}>Add a user</p>
        <form onSubmit={addUser} style={{ marginTop: "var(--space-3)" }}>
          <div className={styles.field}>
            <label htmlFor="new-username" className={styles.fieldLabel}>
              Username
            </label>
            <input id="new-username" name="username" type="text" className={styles.input} required />
          </div>
          <div className={styles.field}>
            <label htmlFor="new-password" className={styles.fieldLabel}>
              Initial password
            </label>
            <input
              id="new-password"
              name="password"
              type="text"
              autoComplete="off"
              className={styles.input}
              minLength={8}
              required
            />
            <p className={styles.fieldHint}>At least 8 characters. Share it with them directly — they can change it later.</p>
          </div>
          <div className={styles.field}>
            <label htmlFor="new-role" className={styles.fieldLabel}>
              Role
            </label>
            <select id="new-role" name="role" className={styles.input} defaultValue="member">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button type="submit" className={styles.buttonPrimary} disabled={submitting}>
            {submitting ? "Adding…" : "Add user"}
          </button>
        </form>
      </section>
    </>
  );
}
