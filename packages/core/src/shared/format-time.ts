/**
 * Real bug this exists to fix: several pages that show a game's start
 * time are Server Components (apps/web/src/app/page.tsx, sports/page.tsx,
 * sports/[gameId]/page.tsx) — `new Date(...).toLocaleTimeString()` there
 * runs on the SERVER, in the server's own timezone (e.g. a VPS set to
 * UTC), not the viewer's. Every caller of clock/date formatting for a
 * game or program now takes an explicit IANA timezone (UiPrefs.timezone)
 * instead, which Intl honors identically regardless of where the code
 * actually executes — the same formatted string server- or client-side.
 */

/** e.g. "7:30 PM" in the given zone. */
export function formatClockTime(epochMs: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(
    new Date(epochMs),
  );
}

/** e.g. "7 PM" — used for a timeline tick, not an exact game time. */
export function formatHourTick(epochMs: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: timezone }).format(new Date(epochMs));
}

/** e.g. "January 4, 2027". */
export function formatLongDate(epochMs: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: timezone }).format(
    new Date(epochMs),
  );
}

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/**
 * Every IANA zone name, for a Settings dropdown — `Intl.supportedValuesOf`
 * is broadly supported (Node 18+, all major evergreen browsers) but not
 * guaranteed everywhere, so this falls back to a short common-zones list
 * rather than leaving the dropdown empty on an older runtime.
 */
export function listTimezones(): string[] {
  const intlWithSupportedValuesOf = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const values = intlWithSupportedValuesOf.supportedValuesOf?.("timeZone");
    // "UTC" is a perfectly valid Intl timeZone value (used as this app's
    // own default) but isn't actually part of the IANA tz database
    // supportedValuesOf enumerates, so it's missing from that list even
    // though every runtime accepts it — prepended explicitly rather than
    // leaving the default value unselectable in its own dropdown.
    if (values && values.length > 0) return values.includes("UTC") ? values : ["UTC", ...values];
  } catch {
    // Fall through to the static list below.
  }
  return COMMON_TIMEZONES;
}
