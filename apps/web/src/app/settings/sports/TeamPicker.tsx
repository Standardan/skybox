"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../settings.module.css";

interface TeamResult {
  name: string;
  league: string;
  leagueLabel: string;
}

const DEBOUNCE_MS = 200;

/**
 * Search-and-select only — no free text (D-024). Typing a team name used to
 * accept anything, including typos, and had no idea which league a team
 * belonged to, so following a team without separately enabling its league
 * silently produced zero games. Picking from real search results fixes both:
 * the name is always exactly right, and the league comes along with it.
 */
export function TeamPicker({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (team: TeamResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TeamResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sports/teams?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        setResults(data.teams ?? []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function pick(team: TeamResult) {
    onPick(team);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div className={styles.field} style={{ position: "relative" }}>
      <label htmlFor="team-search" className={styles.fieldLabel}>
        Find a team
      </label>
      <input
        id="team-search"
        type="text"
        className={styles.input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Start typing a team name…"
        disabled={disabled}
        autoComplete="off"
      />
      <p className={styles.fieldHint}>Across NFL, NBA, MLB, NHL, and Premier League — pick from real results, not free text.</p>

      {open && (
        <ul
          className={styles.panel}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 10,
            maxHeight: 260,
            overflowY: "auto",
            listStyle: "none",
            margin: 0,
            background: "var(--surface)",
          }}
        >
          {loading ? (
            <li className={styles.fieldHint} style={{ padding: "var(--space-3)" }}>
              Searching…
            </li>
          ) : results.length === 0 ? (
            <li className={styles.fieldHint} style={{ padding: "var(--space-3)" }}>
              No teams match &ldquo;{query}&rdquo;.
            </li>
          ) : (
            results.map((team) => (
              <li key={`${team.league}-${team.name}`}>
                <button
                  type="button"
                  className={styles.indexLink}
                  style={{ width: "100%", textAlign: "left", border: "none", background: "none", cursor: "pointer" }}
                  onClick={() => pick(team)}
                >
                  <span className={styles.indexLinkTitle}>{team.name}</span>
                  <span className={styles.indexLinkHint}>{team.leagueLabel}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
