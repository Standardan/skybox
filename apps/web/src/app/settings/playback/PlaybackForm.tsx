"use client";

import { useState } from "react";
import type { PlaybackPrefs } from "@skybox/core/shared";
import { LANGUAGE_OPTIONS } from "@skybox/core/addon-client";
import { SettingsRow, Switch } from "@/components/SettingsRow";
import { setPreferCached, setPreferredResolution, setPreferredLanguage } from "./actions";
import styles from "../settings.module.css";

const RESOLUTIONS: Array<{ value: PlaybackPrefs["preferredResolution"]; label: string }> = [
  { value: "any", label: "No preference" },
  { value: "2160p", label: "4K (2160p)" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
];

/**
 * B5's "best source" ranking, made a real user preference instead of a
 * fixed default: `PlaybackControls` re-sorts each title's streams by this
 * before picking "Play" (see applyPlaybackPrefs in PlaybackControls.tsx) —
 * these toggles genuinely change what plays, not just what's stored.
 */
export function PlaybackForm({ initialPrefs }: { initialPrefs: PlaybackPrefs }) {
  const [prefs, setPrefs] = useState(initialPrefs);

  return (
    <section className={styles.section}>
      <div className={styles.panel}>
        <SettingsRow
          label="Prefer cached sources"
          htmlFor="playback-prefer-cached"
          hint="Pick a debrid-cached source over a higher-resolution uncached one when both exist."
        >
          <Switch
            id="playback-prefer-cached"
            checked={prefs.preferCached}
            onChange={async (checked) => setPrefs(await setPreferCached(checked))}
          />
        </SettingsRow>
        <SettingsRow
          label="Preferred resolution"
          htmlFor="playback-resolution"
          hint="Move sources at this resolution to the front, when available."
        >
          <select
            id="playback-resolution"
            className={styles.input}
            value={prefs.preferredResolution}
            onChange={async (e) =>
              setPrefs(await setPreferredResolution(e.target.value as PlaybackPrefs["preferredResolution"]))
            }
          >
            {RESOLUTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow
          label="Preferred language"
          htmlFor="playback-language"
          hint="Hide sources tagged for a different language. A source with no language tag at all is assumed English — most releases only bother tagging language when it's not English."
        >
          <select
            id="playback-language"
            className={styles.input}
            value={prefs.preferredLanguage}
            onChange={async (e) => setPrefs(await setPreferredLanguage(e.target.value))}
          >
            <option value="any">Any language</option>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsRow>
      </div>
    </section>
  );
}
