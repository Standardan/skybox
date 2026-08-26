import { describe, expect, it } from "vitest";
import type { EpgProgramme } from "../shared/types.js";
import { InMemoryEpgStore } from "./store.js";

function programme(overrides: Partial<EpgProgramme> & Pick<EpgProgramme, "channelId" | "title" | "start" | "stop">): EpgProgramme {
  return { ...overrides };
}

describe("InMemoryEpgStore", () => {
  describe("getNowNext", () => {
    // ch1: [1000,2000) [2000,3000) ... gap ... [5000,6000)
    const p1 = programme({ channelId: "ch1", title: "First", start: 1000, stop: 2000 });
    const p2 = programme({ channelId: "ch1", title: "Second", start: 2000, stop: 3000 });
    const p3 = programme({ channelId: "ch1", title: "Third", start: 5000, stop: 6000 });

    function freshStore(): InMemoryEpgStore {
      const store = new InMemoryEpgStore();
      // Insert out of order and in separate addProgrammes calls to exercise merge+sort.
      store.addProgrammes([p3]);
      store.addProgrammes([p1, p2]);
      return store;
    }

    it("returns now=null, next=first programme before any programmes have started", () => {
      const store = freshStore();
      expect(store.getNowNext("ch1", 500)).toEqual({ now: null, next: p1 });
    });

    it("returns the airing programme as now, and the following one as next, mid-programme", () => {
      const store = freshStore();
      expect(store.getNowNext("ch1", 1500)).toEqual({ now: p1, next: p2 });
    });

    it("treats a boundary instant (equal to one programme's start) as that programme airing", () => {
      const store = freshStore();
      // 2000 == p1.stop == p2.start: p1 is over ([start,stop) is half-open), p2 is now.
      expect(store.getNowNext("ch1", 2000)).toEqual({ now: p2, next: p3 });
    });

    it("returns now=null and the upcoming programme when queried during a gap", () => {
      const store = freshStore();
      expect(store.getNowNext("ch1", 4000)).toEqual({ now: null, next: p3 });
    });

    it("returns now=null, next=null after all known programmes have ended", () => {
      const store = freshStore();
      expect(store.getNowNext("ch1", 7000)).toEqual({ now: null, next: null });
    });

    it("returns now=null, next=null for a channel with no programmes at all", () => {
      const store = freshStore();
      expect(store.getNowNext("unknown-channel", 1500)).toEqual({ now: null, next: null });
    });

    it("defaults `at` to the current time when omitted", () => {
      const store = new InMemoryEpgStore();
      const now = Date.now();
      store.addProgrammes([
        programme({ channelId: "ch1", title: "Currently On", start: now - 1000, stop: now + 1000 }),
      ]);
      const result = store.getNowNext("ch1");
      expect(result.now?.title).toBe("Currently On");
    });
  });

  describe("getProgrammesForChannel", () => {
    const p1 = programme({ channelId: "ch1", title: "First", start: 1000, stop: 2000 });
    const p2 = programme({ channelId: "ch1", title: "Second", start: 2000, stop: 3000 });
    const p3 = programme({ channelId: "ch1", title: "Third", start: 5000, stop: 6000 });

    function freshStore(): InMemoryEpgStore {
      const store = new InMemoryEpgStore();
      store.addProgrammes([p1, p2, p3]);
      return store;
    }

    it("returns all programmes overlapping the requested window", () => {
      const store = freshStore();
      expect(store.getProgrammesForChannel("ch1", 2500, 5500)).toEqual([p2, p3]);
    });

    it("returns an empty array when the window falls entirely in a gap", () => {
      const store = freshStore();
      expect(store.getProgrammesForChannel("ch1", 3000, 5000)).toEqual([]);
    });

    it("returns an empty array for an unknown channel", () => {
      const store = freshStore();
      expect(store.getProgrammesForChannel("unknown-channel", 0, 10_000)).toEqual([]);
    });
  });

  describe("searchByTitle", () => {
    function freshStore(): InMemoryEpgStore {
      const store = new InMemoryEpgStore();
      store.addProgrammes([
        programme({ channelId: "espn", title: "Monday Night Football", start: 1000, stop: 2000 }),
        programme({ channelId: "espn", title: "NBA Tonight", start: 2000, stop: 3000 }),
        programme({ channelId: "nbc", title: "Sunday Night Football", start: 10_000, stop: 11_000 }),
        programme({ channelId: "nbc", title: "Evening News", start: 11_000, stop: 12_000 }),
      ]);
      return store;
    }

    it("matches case-insensitively as a substring, across channels", () => {
      const store = freshStore();
      const results = store.searchByTitle("football");
      expect(results.map((p) => p.title).sort()).toEqual([
        "Monday Night Football",
        "Sunday Night Football",
      ]);
    });

    it("matches regardless of query case", () => {
      const store = freshStore();
      expect(store.searchByTitle("FOOTBALL")).toHaveLength(2);
      expect(store.searchByTitle("FoOtBaLl")).toHaveLength(2);
    });

    it("returns an empty array when nothing matches", () => {
      const store = freshStore();
      expect(store.searchByTitle("cricket")).toEqual([]);
    });

    it("restricts results to the optional [from, to) window", () => {
      const store = freshStore();
      const results = store.searchByTitle("night", { from: 9000, to: 12_000 });
      expect(results.map((p) => p.title)).toEqual(["Sunday Night Football"]);
    });

    it("returns results ordered by start time", () => {
      const store = freshStore();
      // Substring match: "NBA Tonight" also contains "night" ("To-night") —
      // that's correct substring-match behavior, not a bug.
      const results = store.searchByTitle("night");
      expect(results.map((p) => p.start)).toEqual([1000, 2000, 10_000]);
    });
  });

  describe("addProgrammes", () => {
    it("merges multiple calls for the same channel and keeps results sorted by start", () => {
      const store = new InMemoryEpgStore();
      store.addProgrammes([
        programme({ channelId: "ch1", title: "C", start: 3000, stop: 4000 }),
      ]);
      store.addProgrammes([
        programme({ channelId: "ch1", title: "A", start: 1000, stop: 2000 }),
        programme({ channelId: "ch1", title: "B", start: 2000, stop: 3000 }),
      ]);

      const all = store.getProgrammesForChannel("ch1", 0, 10_000);
      expect(all.map((p) => p.title)).toEqual(["A", "B", "C"]);
    });

    it("is a no-op for an empty array", () => {
      const store = new InMemoryEpgStore();
      store.addProgrammes([]);
      expect(store.getProgrammesForChannel("ch1", 0, 10_000)).toEqual([]);
    });
  });
});
