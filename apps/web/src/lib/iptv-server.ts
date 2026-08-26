/**
 * Server-only IPTV + EPG data access, shared by the Live TV and Sports
 * pages (sports matching needs the same channel/EPG data Live TV renders —
 * see packages/core/src/sports/matcher.ts).
 *
 * In-memory cache with a TTL: this app has no persistent DB yet, and a real
 * Xtream account can list tens of thousands of channels (56k+ on Dan's
 * provider — see docs/07-DECISIONS.md), so refetching on every request
 * would be slow and hammers the provider. First request of the app's
 * lifetime pays the real cost; everything else within the TTL is instant.
 */
import "server-only";
import { createIptvClient } from "@skybox/core/iptv";
import { parseXmltv, InMemoryEpgStore } from "@skybox/core/epg";
import type { Channel, ChannelCategory } from "@skybox/core/shared";
import { readConfig } from "./config-store";

const TTL_MS = 10 * 60 * 1000;

interface IptvSnapshot {
  channels: Channel[];
  categories: ChannelCategory[];
  epgStore: InMemoryEpgStore;
  providerId: string | null;
  fetchedAt: number;
}

let cache: IptvSnapshot | null = null;
let inFlight: Promise<IptvSnapshot> | null = null;

async function fetchEpgXml(baseUrl: string, username: string, password: string): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, "")}/xmltv.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const controller = new AbortController();
  // Shorter than you'd expect for an XML payload this size: EPG coverage on
  // this provider is already known to be spotty (OQ-14), so a slow mirror
  // is more likely dead than "almost there" — better to fail fast toward
  // the empty-EPG fallback than make every cold load wait on it.
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    // Explicit no-store (not just the route's fetchCache default) — this
    // dodges a Next.js dev-server bug where its fetch-cache instrumentation
    // chokes on an aborted large-payload request, logging a spurious
    // "Maximum call stack size exceeded" and effectively retrying the
    // whole wait. Not observed under `next build && next start`.
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`EPG fetch failed: ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Races the EPG XML fetch across every candidate mirror at once, same idea
 * as XtreamClient's own mirror failover (packages/core/src/iptv/xtream-client.ts)
 * but run in parallel with `getChannels()`/`getCategories()` instead of
 * waiting for those to resolve a "known good" mirror first — halves cold-start
 * latency on a fresh cache (each leg is otherwise a ~15s-worst-case fetch).
 */
async function fetchEpgFromAnyMirror(baseUrls: string[], username: string, password: string): Promise<InMemoryEpgStore> {
  const store = new InMemoryEpgStore();
  const settled = await Promise.allSettled(baseUrls.map((baseUrl) => fetchEpgXml(baseUrl, username, password)));
  const firstSuccess = settled.find((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled");
  if (firstSuccess) {
    // EPG coverage is known to be spotty for some providers (docs/08-OPEN-QUESTIONS.md
    // OQ-14) — an empty store just means now/next shows nothing, not a crash.
    store.addProgrammes(parseXmltv(firstSuccess.value));
  }
  return store;
}

async function loadSnapshot(): Promise<IptvSnapshot> {
  const config = await readConfig();
  const provider = config.iptv[0];
  if (!provider) {
    return { channels: [], categories: [], epgStore: new InMemoryEpgStore(), providerId: null, fetchedAt: Date.now() };
  }

  const client = createIptvClient(provider);

  const epgPromise: Promise<InMemoryEpgStore> =
    provider.type === "xtream"
      ? fetchEpgFromAnyMirror(provider.baseUrls, provider.username, provider.password)
      : provider.type === "m3u" && provider.epgUrl
        ? fetch(provider.epgUrl)
            .then((res) => (res.ok ? res.text() : null))
            .then((xml) => {
              const store = new InMemoryEpgStore();
              if (xml) store.addProgrammes(parseXmltv(xml));
              return store;
            })
            .catch(() => new InMemoryEpgStore())
        : Promise.resolve(new InMemoryEpgStore());

  // A configured provider whose every mirror is currently down (real
  // possibility — see docs/07-DECISIONS.md D-014, "usually a few working at
  // once") must degrade to the same honest "nothing to show" state pages
  // already handle for "no provider configured," never an unhandled crash.
  const [channelsResult, categoriesResult, epgStore] = await Promise.all([
    client.getChannels().catch(() => [] as Channel[]),
    client.getCategories().catch(() => [] as ChannelCategory[]),
    epgPromise,
  ]);

  return {
    channels: channelsResult,
    categories: categoriesResult,
    epgStore,
    providerId: provider.id,
    fetchedAt: Date.now(),
  };
}

/** Returns the cached snapshot, refreshing it if stale or absent. Concurrent callers share one in-flight fetch. */
export async function getIptvSnapshot(): Promise<IptvSnapshot> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  if (inFlight) return inFlight;

  inFlight = loadSnapshot()
    .then((snapshot) => {
      cache = snapshot;
      return snapshot;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Force a refetch on the next call — used after a Settings change to the IPTV provider. */
export function invalidateIptvSnapshot(): void {
  cache = null;
}
