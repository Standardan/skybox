"use client";

import { useEffect, useState } from "react";
import styles from "../settings.module.css";

interface UpdateStatusData {
  currentSha: string | null;
  latestSha: string | null;
  updateAvailable: boolean;
  repo: string;
  compareUrl: string | null;
  error: string | null;
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "unknown";
}

export function UpdateStatus() {
  const [status, setStatus] = useState<UpdateStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/update")
      .then((res) => res.json())
      .then((data) => setStatus(data))
      .finally(() => setLoading(false));
  }, []);

  async function applyUpdate() {
    setApplying(true);
    setApplyError(null);
    setApplyMessage(null);
    try {
      const res = await fetch("/api/settings/update/apply", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setApplyError(data.error ?? "Could not start the update.");
        setApplying(false);
        return;
      }
      setApplyMessage(
        "Update started — Skybox will restart in a moment. This page won't respond while that happens; just reload it in a bit.",
      );
    } catch {
      setApplyError("Could not reach the server.");
      setApplying(false);
    }
  }

  if (loading) {
    return (
      <section className={styles.panelPadded}>
        <p className={styles.fieldHint}>Checking for updates…</p>
      </section>
    );
  }

  if (!status) {
    return (
      <section className={styles.panelPadded}>
        <p className={styles.errorText}>Could not check for updates.</p>
      </section>
    );
  }

  return (
    <section className={styles.panelPadded}>
      <p className={styles.fieldLabel}>Running version</p>
      <p className={styles.fieldHint}>
        {short(status.currentSha)} — checked against{" "}
        <a href={`https://github.com/${status.repo}`} target="_blank" rel="noreferrer">
          {status.repo}
        </a>
      </p>

      {status.error ? (
        <p className={styles.errorText} style={{ marginTop: "var(--space-3)" }}>
          Couldn&rsquo;t check GitHub: {status.error}
        </p>
      ) : status.updateAvailable ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <p className={styles.successText} role="status">
            An update is available ({short(status.latestSha)}).
          </p>
          {status.compareUrl ? (
            <p className={styles.fieldHint}>
              <a href={status.compareUrl} target="_blank" rel="noreferrer">
                See what&rsquo;s changed
              </a>
            </p>
          ) : null}
          <button
            type="button"
            className={styles.buttonPrimary}
            style={{ marginTop: "var(--space-3)" }}
            onClick={applyUpdate}
            disabled={applying}
          >
            {applying ? "Applying…" : "Apply update"}
          </button>
          {applyMessage ? (
            <p className={styles.successText} style={{ marginTop: "var(--space-3)" }} role="status">
              {applyMessage}
            </p>
          ) : null}
          {applyError ? (
            <p className={styles.errorText} style={{ marginTop: "var(--space-3)" }} role="alert">
              {applyError}
            </p>
          ) : null}
        </div>
      ) : (
        <p className={styles.fieldHint} style={{ marginTop: "var(--space-3)" }}>
          You&rsquo;re up to date.
        </p>
      )}
    </section>
  );
}
