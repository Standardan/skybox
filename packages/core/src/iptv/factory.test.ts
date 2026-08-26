import { describe, expect, it } from "vitest";
import type { M3uCredentials, XtreamCredentials } from "../shared/types.js";
import { createIptvClient } from "./factory.js";
import { M3uClient } from "./m3u-client.js";
import { XtreamClient } from "./xtream-client.js";

const xtreamCredentials: XtreamCredentials = {
  type: "xtream",
  id: "xt-1",
  label: "Xtream Provider",
  baseUrls: ["http://example.com:8080"],
  username: "user",
  password: "pass",
  hiddenCategories: [],
};

const m3uCredentials: M3uCredentials = {
  type: "m3u",
  id: "m3u-1",
  label: "M3U Provider",
  m3uUrl: "http://example.com/playlist.m3u8",
  hiddenCategories: [],
};

describe("createIptvClient", () => {
  it("returns an XtreamClient for type 'xtream'", () => {
    const client = createIptvClient(xtreamCredentials);
    expect(client).toBeInstanceOf(XtreamClient);
    expect(client.providerId).toBe("xt-1");
  });

  it("returns an M3uClient for type 'm3u'", () => {
    const client = createIptvClient(m3uCredentials);
    expect(client).toBeInstanceOf(M3uClient);
    expect(client.providerId).toBe("m3u-1");
  });
});
