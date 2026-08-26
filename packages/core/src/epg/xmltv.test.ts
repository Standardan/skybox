import { describe, expect, it } from "vitest";
import { parseXmltv, parseXmltvTimestamp } from "./xmltv.js";

describe("parseXmltvTimestamp", () => {
  it("parses a +0100 offset by subtracting it from the local wall-clock time", () => {
    // 2026-08-25 20:00:00 local at UTC+1 => 2026-08-25 19:00:00 UTC.
    // Hand-computed: Date.UTC(2026, 7, 25, 19, 0, 0) = 1787684400000.
    expect(parseXmltvTimestamp("20260825200000 +0100")).toBe(1787684400000);
  });

  it("parses a -0500 offset by adding it to the local wall-clock time", () => {
    // 2026-08-25 15:00:00 local at UTC-5 => 2026-08-25 20:00:00 UTC.
    // Hand-computed: Date.UTC(2026, 7, 25, 20, 0, 0) = 1787688000000.
    expect(parseXmltvTimestamp("20260825150000 -0500")).toBe(1787688000000);
  });

  it("parses a +0000 offset and a bare 'Z' offset identically", () => {
    const expected = 1787688000000; // 2026-08-25 20:00:00 UTC
    expect(parseXmltvTimestamp("20260825200000 +0000")).toBe(expected);
    expect(parseXmltvTimestamp("20260825200000 Z")).toBe(expected);
  });

  it("assumes UTC when no offset is present", () => {
    expect(parseXmltvTimestamp("20260825200000")).toBe(1787688000000);
  });

  it("returns null for garbage input instead of throwing", () => {
    expect(parseXmltvTimestamp("not-a-timestamp")).toBeNull();
    expect(parseXmltvTimestamp("2026082520 +0000")).toBeNull();
    expect(parseXmltvTimestamp("20261325200000 +0000")).toBeNull(); // month 13
    expect(() => parseXmltvTimestamp("")).not.toThrow();
  });
});

describe("parseXmltv", () => {
  const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<tv source-info-name="Test Feed">
  <channel id="channel1.example.com">
    <display-name>Channel One</display-name>
  </channel>
  <channel id="channel2.example.com">
    <display-name>Channel Two</display-name>
  </channel>

  <programme start="20260825200000 +0000" stop="20260825223000 +0000" channel="channel1.example.com">
    <title lang="en">Evening News</title>
    <desc lang="en">The day's top stories.</desc>
    <category lang="en">News</category>
  </programme>
  <programme start="20260825223000 +0000" stop="20260826000000 +0000" channel="channel1.example.com">
    <title lang="en">Late Show</title>
  </programme>
  <programme start="20260825150000 -0500" stop="20260825160000 -0500" channel="channel2.example.com">
    <title lang="en">Cross-Timezone Movie &amp; Friends</title>
    <desc lang="en">Tom &amp; Jerry team up &lt;again&gt;.</desc>
  </programme>

  <!-- malformed: unparseable start timestamp -->
  <programme start="not-a-real-timestamp" stop="20260825223000 +0000" channel="channel1.example.com">
    <title>Broken Timestamp Show</title>
  </programme>

  <!-- malformed: missing title entirely -->
  <programme start="20260825200000 +0000" stop="20260825203000 +0000" channel="channel1.example.com">
    <desc>No title here.</desc>
  </programme>

  <!-- malformed: missing channel attribute -->
  <programme start="20260825200000 +0000" stop="20260825203000 +0000">
    <title>Orphan Programme</title>
  </programme>
</tv>`;

  const parsed = parseXmltv(fixture);

  it("extracts only the well-formed programmes, skipping malformed ones", () => {
    expect(parsed).toHaveLength(3);
  });

  it("produces exact epoch ms for known timestamps, honoring offsets", () => {
    const news = parsed.find((p) => p.title === "Evening News");
    expect(news).toBeDefined();
    expect(news?.start).toBe(1787688000000); // 2026-08-25 20:00:00 UTC
    expect(news?.stop).toBe(1787697000000); // 2026-08-25 22:30:00 UTC

    const movie = parsed.find((p) => p.title.startsWith("Cross-Timezone"));
    expect(movie).toBeDefined();
    expect(movie?.start).toBe(1787688000000); // 15:00 -0500 => 20:00 UTC
    expect(movie?.stop).toBe(1787691600000); // 16:00 -0500 => 21:00 UTC
  });

  it("associates programmes with the correct channelId", () => {
    const news = parsed.find((p) => p.title === "Evening News");
    const movie = parsed.find((p) => p.title.startsWith("Cross-Timezone"));
    expect(news?.channelId).toBe("channel1.example.com");
    expect(movie?.channelId).toBe("channel2.example.com");
  });

  it("extracts optional description and omits it when absent", () => {
    const news = parsed.find((p) => p.title === "Evening News");
    const lateShow = parsed.find((p) => p.title === "Late Show");
    expect(news?.description).toBe("The day's top stories.");
    expect(lateShow?.description).toBeUndefined();
  });

  it("decodes XML entities in title and description", () => {
    const movie = parsed.find((p) => p.title.startsWith("Cross-Timezone"));
    expect(movie?.title).toBe("Cross-Timezone Movie & Friends");
    expect(movie?.description).toBe("Tom & Jerry team up <again>.");
  });

  it("returns an empty array for a document with no programmes", () => {
    expect(parseXmltv("<tv><channel id=\"x\"><display-name>X</display-name></channel></tv>")).toEqual([]);
  });

  it("does not throw on completely invalid input", () => {
    expect(() => parseXmltv("not xml at all")).not.toThrow();
    expect(parseXmltv("not xml at all")).toEqual([]);
  });
});
