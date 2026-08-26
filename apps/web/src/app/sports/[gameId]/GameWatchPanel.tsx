"use client";

import { useState } from "react";
import { Player } from "@/components/Player";
import { ChannelOverridePicker, type OverrideChannel } from "@/components/ChannelOverridePicker";
import styles from "./GameWatchPanel.module.css";

export interface ChannelMatchView {
  channelId: string;
  channelName: string;
  channelLogo?: string;
  streamUrl: string;
  streamFormat: "hls" | "ts" | "unknown";
  confidence: number;
  reason: "network" | "epg-title" | "manual-override" | "team-history";
}

const REASON_LABEL: Record<ChannelMatchView["reason"], string> = {
  network: "Matched by broadcast network",
  "epg-title": "Matched by TV guide listing",
  "manual-override": "Manually selected",
  "team-history": "Matched from a past correction for this team",
};

/** Channel.streamFormat's "ts"/"unknown" are direct-playable files as far as the player is concerned. */
function toPlayerFormat(format: ChannelMatchView["streamFormat"]): "hls" | "native" {
  return format === "hls" ? "hls" : "native";
}

/**
 * D5: one click from a matched channel to playing it. D4 follow-up: "not
 * this channel?" lets Dan pick a different real channel when the automatic
 * match is wrong, saved as a manual override for next time.
 */
export function GameWatchPanel({
  gameId,
  title,
  matches,
  league,
  homeTeam,
  awayTeam,
}: {
  gameId: string;
  title: string;
  matches: ChannelMatchView[];
  league: string;
  homeTeam: string;
  awayTeam: string;
}) {
  const [watching, setWatching] = useState<ChannelMatchView | null>(null);
  // No automatic match is a dead end otherwise — open the search right away
  // so finding the real channel doesn't need an extra click first.
  const [pickerOpen, setPickerOpen] = useState(matches.length === 0);

  if (watching) {
    return (
      <div className={styles.playerWrap}>
        <Player
          source={{ url: watching.streamUrl, format: toPlayerFormat(watching.streamFormat) }}
          title={title}
          live={{
            channelName: watching.channelName,
            channelLogo: watching.channelLogo,
            nowNext: null,
            onChannelUp: () => {},
            onChannelDown: () => {},
          }}
          onClose={() => setWatching(null)}
        />
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {matches.length === 0 ? (
        <p className={styles.empty}>
          No automatic match yet — search below. Once you pick the right channel, it&rsquo;s remembered for every
          future {homeTeam}/{awayTeam} game too.
        </p>
      ) : (
        <ul className={styles.list}>
          {matches.map((m) => (
            <li key={m.channelId} className={styles.row}>
              <div className={styles.info}>
                <span className={styles.name}>{m.channelName}</span>
                <span className={styles.reason}>
                  {REASON_LABEL[m.reason]} &middot; {Math.round(m.confidence * 100)}% match
                </span>
              </div>
              <button type="button" className={styles.watchButton} onClick={() => setWatching(m)}>
                Watch on {m.channelName}
              </button>
            </li>
          ))}
        </ul>
      )}

      {matches.length > 0 && (
        <button
          type="button"
          className={styles.altButton}
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
        >
          Not this channel?
        </button>
      )}

      {pickerOpen && (
        <ChannelOverridePicker
          gameId={gameId}
          league={league}
          teamNames={[homeTeam, awayTeam]}
          onSaved={(channel: OverrideChannel) => {
            setPickerOpen(false);
            setWatching({
              channelId: channel.id,
              channelName: channel.name,
              channelLogo: channel.logo,
              streamUrl: channel.streamUrl,
              streamFormat: channel.streamFormat,
              confidence: 1,
              reason: "manual-override",
            });
          }}
        />
      )}
    </div>
  );
}
