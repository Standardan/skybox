"use client";

import { useState } from "react";
import type { UiPrefs } from "@skybox/core/shared";
import { listTimezones } from "@skybox/core/shared";
import { SettingsRow, Switch } from "@/components/SettingsRow";
import { moveRail, setRailVisible, setSportsFirst, setTimezone } from "./actions";
import styles from "../settings.module.css";

const TIMEZONES = listTimezones();

const RAIL_LABELS: Record<string, string> = {
  "today-games": "Today's Games",
  "continue-watching": "Continue Watching",
  "favorite-channels": "Favorite Channels",
  "popular-movies": "Popular Movies",
  "popular-series": "Popular Series",
};

function labelFor(id: string): string {
  return RAIL_LABELS[id] ?? id;
}

export function HomeRailsForm({ initialUi }: { initialUi: UiPrefs }) {
  const [ui, setUi] = useState(initialUi);
  const [busyId, setBusyId] = useState<string | null>(null);

  return (
    <>
      <section className={styles.section}>
        <div className={styles.panel}>
          <SettingsRow
            label="Time zone"
            htmlFor="ui-timezone"
            hint="Used for every game/program time shown in Skybox (Today's Games, Sports, the live guide). Detected automatically from your browser the first time you visit — change it here if that's wrong, or if you want times shown in a different zone."
          >
            <select
              id="ui-timezone"
              className={styles.input}
              value={ui.timezone}
              onChange={async (e) => setUi(await setTimezone(e.target.value))}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </SettingsRow>
          <SettingsRow
            label="Sports-first layout"
            htmlFor="sports-first"
            hint="Pin Today's Games at the top of Home, ahead of Continue Watching."
          >
            <Switch
              id="sports-first"
              checked={ui.sportsFirst}
              onChange={async (checked) => setUi(await setSportsFirst(checked))}
            />
          </SettingsRow>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Rails</h2>
        <div className={styles.panel}>
          {ui.railOrder.map((railId, index) => {
            const visible = !ui.hiddenRails.includes(railId);
            const id = `rail-${railId}`;
            return (
              <SettingsRow key={railId} label={labelFor(railId)} htmlFor={id}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Move ${labelFor(railId)} up`}
                    disabled={index === 0 || busyId === railId}
                    onClick={async () => {
                      setBusyId(railId);
                      setUi(await moveRail(railId, "up"));
                      setBusyId(null);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Move ${labelFor(railId)} down`}
                    disabled={index === ui.railOrder.length - 1 || busyId === railId}
                    onClick={async () => {
                      setBusyId(railId);
                      setUi(await moveRail(railId, "down"));
                      setBusyId(null);
                    }}
                  >
                    ↓
                  </button>
                  <Switch
                    id={id}
                    checked={visible}
                    onChange={async (checked) => setUi(await setRailVisible(railId, checked))}
                  />
                </div>
              </SettingsRow>
            );
          })}
        </div>
      </section>
    </>
  );
}
