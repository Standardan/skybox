/**
 * EPG storage. `EpgStore` is a small interface so this in-memory
 * implementation can later be swapped for an IndexedDB-backed one in the
 * browser layer (this module targets Node/server/test execution — there is
 * no IndexedDB here). See docs/03-ARCHITECTURE.md "epg" module bullet.
 */

import type { EpgNowNext, EpgProgramme } from "../shared/types.js";

export interface EpgStore {
  /** Ingests programmes (e.g. the output of {@link parseXmltv}), merging into existing storage. */
  addProgrammes(programmes: EpgProgramme[]): void;

  /** The currently-airing and next-up programme for a channel at a given instant. */
  getNowNext(channelId: string, at?: number): EpgNowNext;

  /** Programmes on a channel that overlap the [from, to) window, ordered by start. */
  getProgrammesForChannel(channelId: string, from: number, to: number): EpgProgramme[];

  /**
   * Case-insensitive substring match over programme titles, across all
   * channels. Intended for the sports module to fuzzy-match matchup strings
   * against programme titles — kept as simple substring matching, not a
   * full fuzzy-search library.
   */
  searchByTitle(query: string, opts?: { from?: number; to?: number }): EpgProgramme[];
}

function byStartAsc(a: EpgProgramme, b: EpgProgramme): number {
  return a.start - b.start;
}

/**
 * The channel-list side of this (Xtream's `epg_channel_id` on each
 * channel) and the EPG-feed side (the XMLTV `<channel id>` a programme is
 * bucketed under) are maintained by the provider as two loosely-related
 * data sources, not one — real-world reports of "the guide doesn't
 * populate for a lot of channels" trace back to trivial casing/whitespace
 * differences between the two for what's obviously the same channel
 * (e.g. "ESPN.us" vs "espn.us"), which an exact Map key match silently
 * treats as two unrelated channels. Normalizing both sides the same way
 * at every lookup/insert removes that whole class of avoidable miss —
 * it doesn't fix a channel with genuinely no EPG data at all (still a
 * real, expected gap for some providers), only ones that DO have the
 * data under a differently-cased id.
 */
function normalizeChannelId(id: string): string {
  return id.trim().toLowerCase();
}

export class InMemoryEpgStore implements EpgStore {
  private readonly channels = new Map<string, EpgProgramme[]>();

  addProgrammes(programmes: EpgProgramme[]): void {
    if (programmes.length === 0) return;

    const byChannel = new Map<string, EpgProgramme[]>();
    for (const programme of programmes) {
      const key = normalizeChannelId(programme.channelId);
      const bucket = byChannel.get(key);
      if (bucket) {
        bucket.push(programme);
      } else {
        byChannel.set(key, [programme]);
      }
    }

    for (const [channelId, incoming] of byChannel) {
      const existing = this.channels.get(channelId);
      if (existing) {
        existing.push(...incoming);
        existing.sort(byStartAsc);
      } else {
        this.channels.set(
          channelId,
          [...incoming].sort(byStartAsc),
        );
      }
    }
  }

  getNowNext(channelId: string, at: number = Date.now()): EpgNowNext {
    const list = this.channels.get(normalizeChannelId(channelId));
    if (!list || list.length === 0) {
      return { now: null, next: null };
    }

    let now: EpgProgramme | null = null;
    let next: EpgProgramme | null = null;

    for (const programme of list) {
      if (programme.start <= at && at < programme.stop) {
        now = programme;
      }
      if (programme.start > at) {
        next = programme;
        break; // list is sorted ascending by start, so this is the earliest one after `at`
      }
    }

    return { now, next };
  }

  getProgrammesForChannel(channelId: string, from: number, to: number): EpgProgramme[] {
    const list = this.channels.get(normalizeChannelId(channelId));
    if (!list) return [];
    return list.filter((p) => p.stop > from && p.start < to);
  }

  searchByTitle(query: string, opts: { from?: number; to?: number } = {}): EpgProgramme[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];

    const { from, to } = opts;
    const results: EpgProgramme[] = [];

    for (const list of this.channels.values()) {
      for (const programme of list) {
        if (!programme.title.toLowerCase().includes(needle)) continue;
        if (from !== undefined && programme.stop <= from) continue;
        if (to !== undefined && programme.start >= to) continue;
        results.push(programme);
      }
    }

    return results.sort(byStartAsc);
  }
}
