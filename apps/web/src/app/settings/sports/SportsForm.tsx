"use client";

import { useState } from "react";
import type { SportsPrefs } from "@skybox/core/shared";
import { SettingsRow, Switch } from "@/components/SettingsRow";
import { setSportsEnabled, setSpoilerFree, toggleLeague, addTeam, removeTeam } from "./actions";
import styles from "../settings.module.css";

const LEAGUES: Array<{ id: string; label: string }> = [
  { id: "nfl", label: "NFL" },
  { id: "nba", label: "NBA" },
  { id: "mlb", label: "MLB" },
  { id: "nhl", label: "NHL" },
  { id: "epl", label: "Premier League" },
];

export function SportsForm({ initialSports }: { initialSports: SportsPrefs }) {
  const [sports, setSports] = useState(initialSports);
  const [teamInput, setTeamInput] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <>
      <section className={styles.section}>
        <div className={styles.panel}>
          <SettingsRow label="Enable Sports" htmlFor="sports-enabled" hint="Turns the Today's Games rail and Sports tab on or off entirely.">
            <Switch
              id="sports-enabled"
              checked={sports.enabled}
              onChange={async (checked) => setSports(await setSportsEnabled(checked))}
            />
          </SettingsRow>
          <SettingsRow
            label="Spoiler-free"
            htmlFor="sports-spoiler-free"
            hint="Hide live scores until you choose to reveal them."
          >
            <Switch
              id="sports-spoiler-free"
              checked={sports.spoilerFree}
              onChange={async (checked) => setSports(await setSpoilerFree(checked))}
              disabled={!sports.enabled}
            />
          </SettingsRow>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Leagues</h2>
        <div className={styles.panel}>
          {LEAGUES.map((league) => {
            const id = `league-${league.id}`;
            const followed = sports.leagues.includes(league.id);
            return (
              <SettingsRow key={league.id} label={league.label} htmlFor={id}>
                <Switch
                  id={id}
                  checked={followed}
                  disabled={!sports.enabled}
                  onChange={async (checked) => setSports(await toggleLeague(league.id, checked))}
                />
              </SettingsRow>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Teams</h2>
        {sports.teams.length === 0 ? (
          <p className={styles.emptyState}>No teams followed yet.</p>
        ) : (
          <div className={styles.panel}>
            {sports.teams.map((team) => (
              <SettingsRow key={team} label={team}>
                <button
                  type="button"
                  className={`${styles.buttonGhost} ${styles.danger}`}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setSports(await removeTeam(team));
                    setBusy(false);
                  }}
                >
                  Remove
                </button>
              </SettingsRow>
            ))}
          </div>
        )}
        <form
          className={styles.panelPadded}
          style={{ marginTop: "var(--space-3)" }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!teamInput.trim()) return;
            setBusy(true);
            setSports(await addTeam(teamInput));
            setTeamInput("");
            setBusy(false);
          }}
        >
          <div className={styles.field}>
            <label htmlFor="team-name" className={styles.fieldLabel}>
              Team name
            </label>
            <input
              id="team-name"
              type="text"
              className={styles.input}
              value={teamInput}
              onChange={(e) => setTeamInput(e.target.value)}
              placeholder="e.g. Philadelphia Eagles"
              disabled={!sports.enabled}
            />
          </div>
          <button type="submit" className={styles.buttonPrimary} disabled={busy || !sports.enabled}>
            Add team
          </button>
        </form>
      </section>
    </>
  );
}
