import { describe, expect, it } from "vitest";
import { formatClockTime, formatHourTick, formatLongDate, listTimezones } from "./format-time.js";

// A fixed, known instant: 2027-01-04T19:30:00Z.
const EPOCH_MS = Date.UTC(2027, 0, 4, 19, 30, 0);

describe("formatClockTime", () => {
  it("formats the same instant differently depending on the given timezone", () => {
    expect(formatClockTime(EPOCH_MS, "UTC")).toBe("7:30 PM");
    expect(formatClockTime(EPOCH_MS, "America/New_York")).toBe("2:30 PM"); // UTC-5 in January
    expect(formatClockTime(EPOCH_MS, "Asia/Tokyo")).toBe("4:30 AM"); // next day, UTC+9
  });
});

describe("formatHourTick", () => {
  it("formats just the hour in the given timezone", () => {
    expect(formatHourTick(EPOCH_MS, "UTC")).toBe("7 PM");
    expect(formatHourTick(EPOCH_MS, "America/Los_Angeles")).toBe("11 AM"); // UTC-8 in January
  });
});

describe("formatLongDate", () => {
  it("formats a full date in the given timezone, including a day rollover across zones", () => {
    expect(formatLongDate(EPOCH_MS, "UTC")).toBe("January 4, 2027");
    expect(formatLongDate(EPOCH_MS, "Asia/Tokyo")).toBe("January 5, 2027"); // rolls to the next day at UTC+9
  });
});

describe("listTimezones", () => {
  it("returns a non-empty list including well-known zones", () => {
    const zones = listTimezones();
    expect(zones.length).toBeGreaterThan(10);
    expect(zones).toContain("UTC");
    expect(zones).toContain("America/New_York");
  });
});
