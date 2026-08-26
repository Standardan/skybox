import { describe, expect, it } from "vitest";
import { NETWORK_ALIASES, normalizeChannelName } from "./network-aliases.js";

describe("normalizeChannelName", () => {
  it("lowercases and strips a trailing HD tag", () => {
    expect(normalizeChannelName("ESPN HD")).toBe("espn");
  });

  it("strips a US: country-code prefix", () => {
    expect(normalizeChannelName("US: FOX")).toBe("fox");
  });

  it("strips a 3-letter USA: prefix", () => {
    expect(normalizeChannelName("USA: NBC")).toBe("nbc");
  });

  it("strips a pipe-delimited country-code prefix and trailing HD", () => {
    expect(normalizeChannelName("UK|BT Sport 1 HD")).toBe("bt sport 1");
  });

  it("collapses repeated/leading/trailing whitespace", () => {
    expect(normalizeChannelName("  Multiple   Spaces  ")).toBe("multiple spaces");
  });

  it("strips 4K/FHD/UHD tags without touching real content", () => {
    expect(normalizeChannelName("TNT 4K")).toBe("tnt");
    expect(normalizeChannelName("BBC One FHD")).toBe("bbc one");
    expect(normalizeChannelName("Sky Sports UHD")).toBe("sky sports");
  });

  it("does not mangle a plain channel name with no noise", () => {
    expect(normalizeChannelName("TBS")).toBe("tbs");
    expect(normalizeChannelName("NBA TV")).toBe("nba tv");
  });

  it("strips parens, dashes, dots, and other punctuation to whitespace", () => {
    expect(normalizeChannelName("Bally Sports (Detroit)")).toBe("bally sports detroit");
    expect(normalizeChannelName("ESPN-USA")).toBe("espn usa");
    expect(normalizeChannelName("ESPN.2")).toBe("espn 2");
    expect(normalizeChannelName("AT&T SportsNet")).toBe("at t sportsnet");
  });

  it("strips emoji/flag symbols", () => {
    expect(normalizeChannelName("🇺🇸 ESPN USA")).toBe("espn usa");
  });

  it("strips 1080p/720p-style resolution tags", () => {
    expect(normalizeChannelName("ESPN (1080p)")).toBe("espn");
    expect(normalizeChannelName("Sky Sports 720p")).toBe("sky sports");
  });
});

describe("NETWORK_ALIASES", () => {
  const requiredNetworks = [
    "ESPN",
    "ESPN2",
    "ABC",
    "FOX",
    "FS1",
    "TNT",
    "NBC",
    "Peacock",
    "CBS",
    "NBA TV",
    "NFL Network",
    "USA Network",
    "TBS",
    "truTV",
  ];

  it("covers every required canonical network with at least one alias", () => {
    for (const network of requiredNetworks) {
      expect(NETWORK_ALIASES[network]).toBeDefined();
      expect(NETWORK_ALIASES[network]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("is plain lowercase string data (extendable, not logic)", () => {
    for (const aliases of Object.values(NETWORK_ALIASES)) {
      for (const alias of aliases) {
        expect(typeof alias).toBe("string");
        expect(alias).toBe(alias.toLowerCase());
      }
    }
  });
});
