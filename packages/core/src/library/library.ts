/**
 * Continue Watching / watched-unwatched / favorites-watchlist logic (ARCH:
 * library module; REQUIREMENTS B7-B9). Pure and synchronous: every function
 * takes a `LibraryItem[]` and returns a new array, never mutating its input.
 * Persistence (IndexedDB, sync) is out of scope here — see the `sync` module.
 */

import type { ImdbId, LastWorkingSource, LibraryItem, LibraryState, MediaType, WatchProgress } from "../shared/types.js";

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

  const existingIndex = items.findIndex((item) => item.metaId === metaId);
  if (existingIndex === -1) {
    return [...items, { metaId, type, state, progress }];
  }
  // Spread the existing item first — this used to construct a wholly new
  // object here, which silently wiped out any OTHER field a title's
  // LibraryItem carried (lastWorkingSource, added later) every time
  // progress was reported, which happens routinely during normal
  // playback. Preserving unknown/other fields by default means a future
  // field doesn't need every existing mutator function updated in
  // lockstep just to avoid clobbering it.
  const next: LibraryItem = { ...items[existingIndex]!, metaId, type, state, progress };
  return items.map((item, i) => (i === existingIndex ? next : item));
}

/**
 * Explicitly mark a title as fully watched. Clears `progress` since a
 * completed watch has no meaningful resume position.
 */
export function markWatched(items: LibraryItem[], metaId: ImdbId, type: MediaType): LibraryItem[] {
  const existingIndex = items.findIndex((item) => item.metaId === metaId);
  if (existingIndex === -1) {
    return [...items, { metaId, type, state: "watched" }];
  }
  // Same preserve-other-fields reasoning as upsertProgress above —
  // explicitly clears progress (a finished watch has no resume position)
  // but a working source is still worth remembering for a rewatch.
  const next: LibraryItem = { ...items[existingIndex]!, metaId, type, state: "watched", progress: undefined };
  return items.map((item, i) => (i === existingIndex ? next : item));
}

/**
 * Records the specific source (infoHash+fileIdx or url) that just
 * successfully played for `videoId`, so a later visit can try that exact
 * one first instead of starting the whole ranking/auto-retry over from
 * scratch. Creates the item (as `watching`, mirroring upsertProgress)
 * if none exists yet — this can fire before the first progress report.
 */
export function setLastWorkingSource(
  items: LibraryItem[],
  metaId: ImdbId,
  type: MediaType,
  source: LastWorkingSource,
): LibraryItem[] {
  const existingIndex = items.findIndex((item) => item.metaId === metaId);
  if (existingIndex === -1) {
    return [...items, { metaId, type, state: "watching", lastWorkingSource: source }];
  }
  const next: LibraryItem = { ...items[existingIndex]!, lastWorkingSource: source };
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
