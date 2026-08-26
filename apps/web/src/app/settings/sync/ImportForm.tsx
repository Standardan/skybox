"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../settings.module.css";

const REQUIRED_KEYS = ["addons", "debrid", "iptv", "sports", "ui"] as const;

function hasExpectedShape(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return REQUIRED_KEYS.every((key) => key in v);
}

export function ImportForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a config file first.");
      return;
    }

    setBusy(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setError("That file isn't valid JSON.");
        return;
      }
      if (!hasExpectedShape(parsed)) {
        setError("That file doesn't look like a Skybox config export (missing addons/debrid/iptv/sports/ui).");
        return;
      }

      const res = await fetch("/api/settings/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not import that file.");
        return;
      }
      setSuccess("Config imported. Reloading with your imported settings.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch {
      setError("Could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.panelPadded}>
      <div className={styles.field}>
        <label htmlFor="import-file" className={styles.fieldLabel}>
          Config file
        </label>
        <input id="import-file" type="file" accept="application/json,.json" ref={fileInputRef} className={styles.input} />
        <p className={styles.fieldHint}>
          This replaces your current configuration, including your debrid connection and IPTV
          providers.
        </p>
      </div>
      {error ? (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      ) : null}
      {success ? <p className={styles.successText}>{success}</p> : null}
      <button type="submit" className={styles.buttonPrimary} disabled={busy}>
        {busy ? "Importing…" : "Import config"}
      </button>
    </form>
  );
}
