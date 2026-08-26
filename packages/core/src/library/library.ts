/**
 * Continue Watching / watched-unwatched / favorites-watchlist logic (ARCH:
 * library module; REQUIREMENTS B7-B9). Pure and synchronous: every function
 * takes a `LibraryItem[]` and returns a new array, never mutating its input.
 * Persistence (IndexedDB, sync) is out of scope here — see the `sync` module.
 */

import type { ImdbId, LibraryItem, LibraryState, MediaType, WatchProgress } from "../shared/types.js";

/** A title is considered fully watched once progress crosses this fraction. */
const WATCHED_THRESHOLD = 0.9;

function isComplete(progress: WatchProgress): boolean {
  if (progress.durationSec <= 0) return false;
  return progress.positionSec / progress.durationSec >= WATCHED_THRESHOLD;
}

/**
 * Upsert playback progress for `metaId`. Creates the item if it doesn't
 * exist yet. Sets `state: 'watching'`, unless the new progress implies the
 * title is effectively finished (>= 90% through), in which case the item is
 * marked `'watched'` instead — a convenience for players that never emit an
 * explicit "mark watched" event and just stop updating progress near the end.
 */
export function upsertProgress(
  items: LibraryItem[],
  metaId: ImdbId,
  type: MediaType,
  progress: WatchProgress,
): LibraryItem[] {
  const state: LibraryState = isComplete(progress) ? "watched" : "watching";
  const next: LibraryItem = { metaId, type, state, progress };

  const existingIndex = items.findIndex((item) => item.metaId === metaId);
  if (existingIndex === -1) {
    return [...items, next];
  }
  return items.map((item, i) => (i === existingIndex ? next : item));
}

/**
 * Explicitly mark a title as fully watched. Clears `progress` since a
 * completed watch has no meaningful resume position.
 */
export function markWatched(items: LibraryItem[], metaId: ImdbId, type: MediaType): LibraryItem[] {
  const next: LibraryItem = { metaId, type, state: "watched" };

  const existingIndex = items.findIndex((item) => item.metaId === metaId);
  if (existingIndex === -1) {
    return [...items, next];
  }
  return items.map((item, i) => (i === existingIndex ? next : item));
}

/**
 * Mark a title unwatched. Judgment call: "unwatched" isn't a distinct state
 * in the model (LibraryState is watching|watched|watchlist) — it's the
 * *absence* of watch progress — so we drop the item entirely rather than
 * inventing a fourth state, unless the user also wanted it on their
 * watchlist, in which case that intent is preserved.
 */
export function markUnwatched(items: LibraryItem[], metaId: ImdbId): LibraryItem[] {
  return items.filter((item) => !(item.metaId === metaId && item.state !== "watchlist"));
}

/**
 * Add a title to the watchlist ("want to watch"). Never downgrades an item
 * that's already `watching` or `watched` — the watchlist intent is moot once
 * you've started or finished the title, so an existing further-along item is
 * left untouched.
 */
export function addToWatchlist(items: LibraryItem[], metaId: ImdbId, type: MediaType): LibraryItem[] {
  const existingIndex = items.findIndex((item) => item.metaId === metaId);
  if (existingIndex === -1) {
    return [...items, { metaId, type, state: "watchlist" }];
  }

  const existing = items[existingIndex]!;
  if (existing.state === "watching" || existing.state === "watched") {
    return items;
  }
  if (existing.state === "watchlist") {
    return items;
  }
  return items.map((item, i) => (i === existingIndex ? { metaId, type, state: "watchlist" } : item));
}

/** Remove a title from the watchlist. Leaves watching/watched items alone even if called on one by mistake. */
export function removeFromWatchlist(items: LibraryItem[], metaId: ImdbId): LibraryItem[] {
  return items.filter((item) => !(item.metaId === metaId && item.state === "watchlist"));
}

/** Titles currently in progress, most-recently-updated first, optionally capped to `limit`. */
export function getContinueWatching(items: LibraryItem[], limit?: number): LibraryItem[] {
  const watching = items
    .filter((item): item is LibraryItem & { progress: WatchProgress } => item.state === "watching" && item.progress !== undefined)
    .slice()
    .sort((a, b) => b.progress.updatedAt - a.progress.updatedAt);

  return limit === undefined ? watching : watching.slice(0, limit);
}

/** Titles the user wants to watch. */
export function getWatchlist(items: LibraryItem[]): LibraryItem[] {
  return items.filter((item) => item.state === "watchlist");
}

/** Titles the user has fully watched. */
export function getWatched(items: LibraryItem[]): LibraryItem[] {
  return items.filter((item) => item.state === "watched");
}

/** Look up a single library item by `metaId`. */
export function findItem(items: LibraryItem[], metaId: ImdbId): LibraryItem | undefined {
  return items.find((item) => item.metaId === metaId);
}
