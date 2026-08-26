"use client";

import { useState, type FormEvent } from "react";
import styles from "./ChannelOverridePicker.module.css";

export interface OverrideChannel {
  id: string;
  name: string;
  category: string;
  streamUrls: string[];
  streamFormat: "hls" | "ts" | "unknown";
  logo?: string;
}

/**
 * D4 manual-override path: search the real channel list (server-filtered —
 * a provider can have tens of thousands of channels, see
 * apps/web/src/app/api/sports/channels/route.ts) and pick a replacement
 * when the automatic network/EPG match picked the wrong feed. Saves
 * immediately to `config.sports.channelOverrides[gameId]`, which
 * `matchGameToChannels` always prefers on the next fetch — and, when
 * `league`/`teamNames` are given, also teaches `teamChannelHints` so this
 * channel is checked automatically for every future game either team plays.
 */
export function ChannelOverridePicker({
  gameId,
  league,
  teamNames,
  onSaved,
}: {
  gameId: string;
  league?: string;
  teamNames?: string[];
  onSaved: (channel: OverrideChannel) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OverrideChannel[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [searched, setSearched] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setStatus("loading");
    try {
      const res = await fetch(`/api/sports/channels?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error("search failed");
      const data = (await res.json()) as { channels: OverrideChannel[] };
      setResults(data.channels);
      setSearched(true);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  async function pick(channel: OverrideChannel) {
    setStatus("saving");
    try {
      const res = await fetch("/api/sports/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, channelId: channel.id, league, teamNames }),
      });
      if (!res.ok) throw new Error("save failed");
      onSaved(channel);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className={styles.picker}>
      <form onSubmit={search} className={styles.form}>
        <label htmlFor="channel-search" className={styles.label}>
          Find a channel
        </label>
        <div className={styles.searchRow}>
          <input
            id="channel-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={styles.input}
            placeholder="Channel name"
          />
          <button type="submit" className={styles.searchButton} disabled={status === "loading"}>
            Search
          </button>
        </div>
      </form>

      {status === "error" && <p className={styles.error}>Something went wrong. Try again.</p>}
      {searched && results.length === 0 && status !== "error" && (
        <p className={styles.empty}>No channels match &ldquo;{query}&rdquo;.</p>
      )}

      {results.length > 0 && (
        <ul className={styles.results}>
          {results.map((channel) => (
            <li key={channel.id}>
              <button
                type="button"
                className={styles.resultButton}
                onClick={() => pick(channel)}
                disabled={status === "saving"}
              >
                <span className={styles.resultName}>{channel.name}</span>
                <span className={styles.resultCategory}>{channel.category}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
