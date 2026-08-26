"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AddonRef } from "@skybox/core/shared";
import { SettingsRow } from "@/components/SettingsRow";
import styles from "../settings.module.css";

interface AddonManagerProps {
  initialAddons: AddonRef[];
}

export function AddonManager({ initialAddons }: AddonManagerProps) {
  const router = useRouter();
  const [addons, setAddons] = useState(initialAddons);
  const [url, setUrl] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddSuccess(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setAddError("Enter a manifest URL.");
      return;
    }

    setBusyUrl("__add__");
    try {
      const res = await fetch("/api/settings/addons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transportUrl: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? "Could not add that addon.");
        return;
      }
      setAddons((prev) => [...prev, data.addon]);
      setAddSuccess(`Added ${data.addon?.manifest?.name ?? "addon"}.`);
      setUrl("");
      startTransition(() => router.refresh());
    } catch {
      setAddError("Could not reach the server. Try again.");
    } finally {
      setBusyUrl(null);
    }
  }

  async function handleReorder(transportUrl: string, direction: "up" | "down") {
    setBusyUrl(transportUrl);
    try {
      const res = await fetch("/api/settings/addons", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transportUrl, direction }),
      });
      const data = await res.json();
      if (res.ok) {
        setAddons([...data.addons].sort((a: AddonRef, b: AddonRef) => a.order - b.order));
        startTransition(() => router.refresh());
      }
    } finally {
      setBusyUrl(null);
    }
  }

  async function handleRemove(transportUrl: string) {
    setBusyUrl(transportUrl);
    try {
      const res = await fetch("/api/settings/addons", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transportUrl }),
      });
      const data = await res.json();
      if (res.ok) {
        setAddons([...data.addons].sort((a: AddonRef, b: AddonRef) => a.order - b.order));
        startTransition(() => router.refresh());
      }
    } finally {
      setBusyUrl(null);
    }
  }

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Installed</h2>
        {addons.length === 0 ? (
          <p className={styles.emptyState}>No addons installed yet.</p>
        ) : (
          <div className={styles.panel}>
            {addons.map((addon, index) => (
              <SettingsRow key={addon.transportUrl} label={addon.manifest?.name ?? addon.transportUrl}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Move ${addon.manifest?.name ?? "addon"} up`}
                    disabled={index === 0 || busyUrl === addon.transportUrl}
                    onClick={() => handleReorder(addon.transportUrl, "up")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Move ${addon.manifest?.name ?? "addon"} down`}
                    disabled={index === addons.length - 1 || busyUrl === addon.transportUrl}
                    onClick={() => handleReorder(addon.transportUrl, "down")}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={`${styles.buttonGhost} ${styles.danger}`}
                    disabled={busyUrl === addon.transportUrl}
                    onClick={() => handleRemove(addon.transportUrl)}
                  >
                    Remove
                  </button>
                </div>
              </SettingsRow>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Add addon</h2>
        <form onSubmit={handleAdd} className={styles.panelPadded}>
          <div className={styles.field}>
            <label htmlFor="addon-url" className={styles.fieldLabel}>
              Manifest URL
            </label>
            <input
              id="addon-url"
              type="url"
              inputMode="url"
              className={styles.input}
              placeholder="https://example.com/manifest.json"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busyUrl === "__add__"}
            />
            {addError ? (
              <p className={styles.errorText} role="alert">
                {addError}
              </p>
            ) : null}
            {addSuccess ? <p className={styles.successText}>{addSuccess}</p> : null}
          </div>
          <button type="submit" className={styles.buttonPrimary} disabled={busyUrl === "__add__" || isPending}>
            {busyUrl === "__add__" ? "Checking addon…" : "Add addon"}
          </button>
        </form>
      </section>
    </>
  );
}
