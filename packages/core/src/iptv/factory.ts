import type { IptvClient, IptvProvider } from "../shared/types.js";
import { M3uClient } from "./m3u-client.js";
import { XtreamClient } from "./xtream-client.js";

/** Builds the right IptvClient implementation for a provider's config type. */
export function createIptvClient(provider: IptvProvider): IptvClient {
  switch (provider.type) {
    case "xtream":
      return new XtreamClient(provider);
    case "m3u":
      return new M3uClient(provider);
    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unsupported IPTV provider type: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
