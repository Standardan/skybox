import { describe, it, expect } from "vitest";
import { parseRuntimeMinutes, isLikelyTrailerRuntime } from "./runtime-check.js";

describe("parseRuntimeMinutes", () => {
  it("parses Cinemeta's common plain form", () => {
    expect(parseRuntimeMinutes("148 min")).toBe(148);
    expect(parseRuntimeMinutes("90 min")).toBe(90);
  });

  it("parses hour+minute forms", () => {
    expect(parseRuntimeMinutes("2h 15m")).toBe(135);
    expect(parseRuntimeMinutes("1hr 30min")).toBe(90);
  });

  it("parses an hours-only form", () => {
    expect(parseRuntimeMinutes("2h")).toBe(120);
  });

  it("parses a bare number with no unit as minutes", () => {
    expect(parseRuntimeMinutes("148")).toBe(148);
  });

  it("returns null for missing or unparseable input", () => {
    expect(parseRuntimeMinutes(undefined)).toBeNull();
    expect(parseRuntimeMinutes("")).toBeNull();
    expect(parseRuntimeMinutes("TV-MA")).toBeNull();
  });
});

describe("isLikelyTrailerRuntime", () => {
  it("flags a short file against a real movie's runtime", () => {
    expect(isLikelyTrailerRuntime(150, 148)).toBe(true); // 2.5 min file, 148 min movie
    expect(isLikelyTrailerRuntime(300, 90)).toBe(true); // 5 min file, 90 min movie
  });

  it("does not flag a real full-length file", () => {
    expect(isLikelyTrailerRuntime(148 * 60, 148)).toBe(false); // exact match
    expect(isLikelyTrailerRuntime(140 * 60, 148)).toBe(false); // slightly shorter cut
    expect(isLikelyTrailerRuntime(165 * 60, 148)).toBe(false); // extended cut, longer
  });

  it("does not flag anything when the expected runtime itself is short", () => {
    // A genuine 15-minute short film shouldn't get flagged just because
    // some real cut of it happens to be a few minutes shorter.
    expect(isLikelyTrailerRuntime(5 * 60, 15)).toBe(false);
  });

  it("requires both conditions — under half AND under 20 minutes absolute", () => {
    // A 3-hour movie playing a 25-minute file is under half the runtime
    // but NOT under the 20-minute absolute floor — stays conservative
    // rather than flagging a possible extended/alternate-cut edge case.
    expect(isLikelyTrailerRuntime(25 * 60, 180)).toBe(false);
    // The same file at 15 minutes crosses both thresholds.
    expect(isLikelyTrailerRuntime(15 * 60, 180)).toBe(true);
  });
});
