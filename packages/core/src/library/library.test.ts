import { describe, expect, it } from "vitest";
import type { LibraryItem, WatchProgress } from "../shared/types.js";
import {
  addToWatchlist,
  findItem,
  getContinueWatching,
  getWatched,
  getWatchlist,
  markUnwatched,
  markWatched,
  removeFromWatchlist,
  upsertProgress,
} from "./library.js";

function progress(overrides: Partial<WatchProgress> = {}): WatchProgress {
  return {
    videoId: "vid-1",
    positionSec: 100,
    durationSec: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("upsertProgress", () => {
  it("creates a new item for a brand-new metaId", () => {
    const items: LibraryItem[] = [];
    const p = progress();
    const result = upsertProgress(items, "tt0000001", "movie", p);

    expect(result).toEqual([{ metaId: "tt0000001", type: "movie", state: "watching", progress: p }]);
    expect(result).not.toBe(items);
    expect(items).toEqual([]);
  });

  it("updates an existing item's progress and keeps state 'watching' below the threshold", () => {
    const original: LibraryItem = {
      metaId: "tt0000001",
      type: "movie",
      state: "watching",
      progress: progress({ positionSec: 50, updatedAt: 500 }),
    };
    const items = [original];
    const newProgress = progress({ positionSec: 200, durationSec: 1000, updatedAt: 900 });

    const result = upsertProgress(items, "tt0000001", "movie", newProgress);

    expect(result).not.toBe(items);
    expect(result[0]).not.toBe(original);
    expect(result).toEqual([{ metaId: "tt0000001", type: "movie", state: "watching", progress: newProgress }]);
    // input untouched
    expect(items).toEqual([original]);
    expect(items[0]).toBe(original);
  });

  it("crosses the 90% threshold and flips state to 'watched'", () => {
    const items: LibraryItem[] = [
      { metaId: "tt0000001", type: "movie", state: "watching", progress: progress({ positionSec: 100, durationSec: 1000 }) },
    ];
    const nearlyDone = progress({ positionSec: 900, durationSec: 1000, updatedAt: 2000 });

    const result = upsertProgress(items, "tt0000001", "movie", nearlyDone);

    expect(result[0]!.state).toBe("watched");
    expect(result[0]!.progress).toEqual(nearlyDone);
  });

  it("stays 'watching' just below the threshold (89.9%)", () => {
    const items: LibraryItem[] = [];
    const almostThere = progress({ positionSec: 899, durationSec: 1000 });

    const result = upsertProgress(items, "tt0000001", "movie", almostThere);

    expect(result[0]!.state).toBe("watching");
  });

  it("is exactly at the threshold (90%) and marks watched (inclusive boundary)", () => {
    const items: LibraryItem[] = [];
    const exact = progress({ positionSec: 900, durationSec: 1000 });

    const result = upsertProgress(items, "tt0000001", "movie", exact);

    expect(result[0]!.state).toBe("watched");
  });

  it("does not mutate other items in the array", () => {
    const other: LibraryItem = { metaId: "tt9999999", type: "series", state: "watchlist" };
    const items = [other];

    const result = upsertProgress(items, "tt0000001", "movie", progress());

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(other);
  });
});

describe("markWatched", () => {
  it("upserts a new item as watched with no progress", () => {
    const items: LibraryItem[] = [];
    const result = markWatched(items, "tt0000001", "movie");

    expect(result).toEqual([{ metaId: "tt0000001", type: "movie", state: "watched" }]);
    expect(items).toEqual([]);
  });

  it("clears progress on an existing in-progress item", () => {
    const original: LibraryItem = {
      metaId: "tt0000001",
      type: "movie",
      state: "watching",
      progress: progress(),
    };
    const items = [original];

    const result = markWatched(items, "tt0000001", "movie");

    expect(result[0]).toEqual({ metaId: "tt0000001", type: "movie", state: "watched" });
    expect(result[0]!.progress).toBeUndefined();
    expect(items[0]).toBe(original);
    expect(items[0]!.progress).toEqual(progress());
  });
});

describe("markUnwatched", () => {
  it("removes a 'watching' item entirely", () => {
    const items: LibraryItem[] = [{ metaId: "tt0000001", type: "movie", state: "watching", progress: progress() }];
    const result = markUnwatched(items, "tt0000001");
    expect(result).toEqual([]);
    expect(items).toHaveLength(1);
  });

  it("removes a 'watched' item entirely", () => {
    const items: LibraryItem[] = [{ metaId: "tt0000001", type: "movie", state: "watched" }];
    const result = markUnwatched(items, "tt0000001");
    expect(result).toEqual([]);
  });

  it("preserves a 'watchlist' item for the same metaId (watchlist intent survives)", () => {
    const items: LibraryItem[] = [{ metaId: "tt0000001", type: "movie", state: "watchlist" }];
    const result = markUnwatched(items, "tt0000001");
    expect(result).toEqual(items);
    expect(result).not.toBe(items);
  });

  it("leaves unrelated items untouched", () => {
    const other: LibraryItem = { metaId: "tt9999999", type: "movie", state: "watching", progress: progress() };
    const items = [other, { metaId: "tt0000001", type: "movie" as const, state: "watched" as const }];

    const result = markUnwatched(items, "tt0000001");

    expect(result).toEqual([other]);
    expect(result[0]).toBe(other);
  });
});

describe("addToWatchlist", () => {
  it("creates a new watchlist item when absent", () => {
    const items: LibraryItem[] = [];
    const result = addToWatchlist(items, "tt0000001", "series");
    expect(result).toEqual([{ metaId: "tt0000001", type: "series", state: "watchlist" }]);
  });

  it("does not downgrade an existing 'watching' item", () => {
    const original: LibraryItem = { metaId: "tt0000001", type: "movie", state: "watching", progress: progress() };
    const items = [original];

    const result = addToWatchlist(items, "tt0000001", "movie");

    expect(result).toBe(items); // unchanged, same reference
    expect(result[0]).toBe(original);
  });

  it("does not downgrade an existing 'watched' item", () => {
    const original: LibraryItem = { metaId: "tt0000001", type: "movie", state: "watched" };
    const items = [original];

    const result = addToWatchlist(items, "tt0000001", "movie");

    expect(result).toBe(items);
  });

  it("is idempotent when already on the watchlist", () => {
    const original: LibraryItem = { metaId: "tt0000001", type: "movie", state: "watchlist" };
    const items = [original];

    const result = addToWatchlist(items, "tt0000001", "movie");

    expect(result).toBe(items);
  });
});

describe("removeFromWatchlist", () => {
  it("removes a watchlist item", () => {
    const items: LibraryItem[] = [{ metaId: "tt0000001", type: "movie", state: "watchlist" }];
    const result = removeFromWatchlist(items, "tt0000001");
    expect(result).toEqual([]);
  });

  it("leaves a 'watching' item alone even if called by mistake", () => {
    const original: LibraryItem = { metaId: "tt0000001", type: "movie", state: "watching", progress: progress() };
    const items = [original];

    const result = removeFromWatchlist(items, "tt0000001");

    expect(result).toEqual(items);
    expect(result[0]).toBe(original);
  });

  it("leaves a 'watched' item alone even if called by mistake", () => {
    const original: LibraryItem = { metaId: "tt0000001", type: "movie", state: "watched" };
    const items = [original];

    const result = removeFromWatchlist(items, "tt0000001");

    expect(result).toEqual(items);
  });
});

describe("getContinueWatching", () => {
  const a: LibraryItem = { metaId: "tt1", type: "movie", state: "watching", progress: progress({ updatedAt: 100 }) };
  const b: LibraryItem = { metaId: "tt2", type: "movie", state: "watching", progress: progress({ updatedAt: 300 }) };
  const c: LibraryItem = { metaId: "tt3", type: "movie", state: "watching", progress: progress({ updatedAt: 200 }) };
  const watched: LibraryItem = { metaId: "tt4", type: "movie", state: "watched" };
  const watchlist: LibraryItem = { metaId: "tt5", type: "movie", state: "watchlist" };

  it("filters to state 'watching' only", () => {
    const items = [a, watched, watchlist, b, c];
    const result = getContinueWatching(items);
    expect(result.map((i) => i.metaId)).toEqual(["tt2", "tt3", "tt1"]);
  });

  it("sorts by progress.updatedAt descending", () => {
    const items = [a, b, c];
    const result = getContinueWatching(items);
    expect(result.map((i) => i.progress!.updatedAt)).toEqual([300, 200, 100]);
  });

  it("respects an optional limit", () => {
    const items = [a, b, c];
    const result = getContinueWatching(items, 2);
    expect(result.map((i) => i.metaId)).toEqual(["tt2", "tt3"]);
  });

  it("does not mutate the input array order", () => {
    const items = [a, b, c];
    const snapshot = [...items];
    getContinueWatching(items);
    expect(items).toEqual(snapshot);
  });

  it("returns an empty array when nothing is watching", () => {
    expect(getContinueWatching([watched, watchlist])).toEqual([]);
  });
});

describe("getWatchlist", () => {
  it("filters to state 'watchlist'", () => {
    const w: LibraryItem = { metaId: "tt1", type: "movie", state: "watchlist" };
    const items: LibraryItem[] = [
      w,
      { metaId: "tt2", type: "movie", state: "watching", progress: progress() },
      { metaId: "tt3", type: "movie", state: "watched" },
    ];
    expect(getWatchlist(items)).toEqual([w]);
  });
});

describe("getWatched", () => {
  it("filters to state 'watched'", () => {
    const w: LibraryItem = { metaId: "tt1", type: "movie", state: "watched" };
    const items: LibraryItem[] = [
      w,
      { metaId: "tt2", type: "movie", state: "watching", progress: progress() },
      { metaId: "tt3", type: "movie", state: "watchlist" },
    ];
    expect(getWatched(items)).toEqual([w]);
  });
});

describe("findItem", () => {
  it("finds an item by metaId", () => {
    const target: LibraryItem = { metaId: "tt2", type: "movie", state: "watched" };
    const items: LibraryItem[] = [{ metaId: "tt1", type: "movie", state: "watchlist" }, target];
    expect(findItem(items, "tt2")).toBe(target);
  });

  it("returns undefined when not found", () => {
    expect(findItem([], "tt404")).toBeUndefined();
  });
});
