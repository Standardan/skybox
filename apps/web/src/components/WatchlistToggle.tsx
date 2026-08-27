"use client";

import { useState } from "react";
import type { MediaType } from "@skybox/core/shared";
import styles from "./PlaybackControls.module.css";

/** My List (B9). Rendered alongside PlaybackControls on the title page. */
export function WatchlistToggle({
  metaId,
  type,
  initialOnWatchlist,
}: {
  metaId: string;
  type: MediaType;
  initialOnWatchlist: boolean;
}) {
  const [onWatchlist, setOnWatchlist] = useState(initialOnWatchlist);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !onWatchlist;
    setOnWatchlist(next); // optimistic
    setBusy(true);
    try {
      await fetch("/api/library/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: next ? "add" : "remove", metaId, type }),
      });
    } catch {
      setOnWatchlist(!next); // revert on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={styles.secondary} onClick={() => void toggle()} disabled={busy}>
      {onWatchlist ? "Remove from My List" : "Add to My List"}
    </button>
  );
}
