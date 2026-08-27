/**
 * Real feature request: "we need to make sure we don't accidentally play
 * a trailer instead of the real movie." Some releases (fake/mislabeled
 * uploads) resolve and play successfully but are actually just a trailer
 * or teaser — not a Skybox bug, but genuinely detectable: Cinemeta's own
 * `runtime` field (e.g. "148 min") is the real movie's actual length, so
 * once the browser knows how long the file it's ACTUALLY playing is
 * (`video.duration`, available once metadata loads), a huge mismatch
 * against the expected runtime is a strong, reliable signal — far more
 * reliable than any filename/title heuristic, since a fake upload's
 * title usually just claims to be the real movie.
 */

/**
 * Cinemeta's runtime string is commonly a plain "148 min", but this
 * parses "2h 15m"/"2h"/"90m" forms too rather than assuming one exact
 * format. Returns null (not 0) when nothing parseable is found, so a
 * caller can tell "no runtime data" apart from "runtime is zero".
 */
export function parseRuntimeMinutes(runtime: string | undefined): number | null {
  if (!runtime) return null;
  const hoursMatch = /(\d+)\s*(?:h|hr|hour)/i.exec(runtime);
  const minutesMatch = /(\d+)\s*(?:m|min)/i.exec(runtime);
  const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
  const minutes = minutesMatch ? Number(minutesMatch[1]) : 0;
  if (!hoursMatch && !minutesMatch) {
    // Bare number with no unit at all, e.g. "148" — Cinemeta's plain form
    // sometimes omits "min" — treat a lone number as minutes.
    const bare = /^\s*(\d+)\s*$/.exec(runtime);
    if (bare) return Number(bare[1]);
    return null;
  }
  const total = hours * 60 + minutes;
  return total > 0 ? total : null;
}

/**
 * True when `actualSeconds` (the real, playing file's duration) is
 * suspiciously short next to `expectedMinutes` (Cinemeta's stated
 * runtime) — the signature of a trailer/teaser standing in for the real
 * movie. Two conditions, both required, to stay conservative: under half
 * the expected runtime (a legitimate theatrical-vs-extended-cut
 * difference is nowhere close to 2x) AND under 20 minutes absolute (so a
 * short film's expected runtime alone can't make a real, slightly-
 * trimmed cut look like a trailer). Only meaningful for substantial
 * expected runtimes — under 20 minutes expected, there's no reliable
 * "this is definitely a trailer" signal to find here at all.
 */
export function isLikelyTrailerRuntime(actualSeconds: number, expectedMinutes: number): boolean {
  if (expectedMinutes < 20) return false;
  const expectedSeconds = expectedMinutes * 60;
  return actualSeconds < expectedSeconds * 0.5 && actualSeconds < 20 * 60;
}
