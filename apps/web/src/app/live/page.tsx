import Link from "next/link";
import { redirect } from "next/navigation";
import type { EpgNowNext } from "@skybox/core/shared";
import { getIptvSnapshot } from "@/lib/iptv-server";
import { GuideGrid } from "@/components/GuideGrid";
import { TopNav } from "@/components/TopNav";
import { isRequestHttps, resolvePlaybackStreamUrls } from "@/lib/stream-proxy";
import { getCurrentUser } from "@/lib/session";
import { readLiveTvPrefs } from "@/lib/live-tv-prefs-store";
import styles from "./page.module.css";

// This route's IPTV/EPG fetches are already cached at the application layer
// (iptv-server.ts's own 10-minute TTL, racing up to 13 real provider
// mirrors concurrently) — stacking Next's automatic per-request fetch cache
// on top is redundant and, worse, its cache-write path throws on an
// aborted/timed-out fetch (a real Next.js dev-mode bug triggered by this
// route's concurrent-mirror-race + timeout pattern). Opting out avoids it.
export const fetchCache = "default-no-store";
// Real, per-viewer, frequently-changing data — never statically prerendered.
export const dynamic = "force-dynamic";

/**
 * Live TV — Server Component. Fetches the real Xtream snapshot (channels,
 * categories, EPG store — see apps/web/src/lib/iptv-server.ts) and hands
 * plain, serializable data down to the interactive guide. The EpgStore
 * instance itself can't cross the Server/Client boundary (it's a class,
 * not serializable RSC data), so now/next is resolved here, once per
 * distinct `epgChannelId`, into a plain lookup map.
 */
export default async function LiveTvPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ channels, categories, epgStore }, prefs] = await Promise.all([
    getIptvSnapshot(),
    readLiveTvPrefs(user.id),
  ]);

  if (channels.length === 0) {
    return (
      <>
        <TopNav />
        <main className={styles.empty}>
          <h1 className={styles.emptyTitle}>No Live TV provider connected</h1>
          <p className={styles.emptyBody}>
            Add an Xtream or M3U provider in{" "}
            <Link href="/settings/iptv" className={styles.emptyLink}>
              Settings
            </Link>{" "}
            to see your channels here.
          </p>
        </main>
      </>
    );
  }

  const nowNextByEpgId: Record<string, EpgNowNext> = {};
  const now = Date.now();
  for (const channel of channels) {
    const epgId = channel.epgChannelId;
    // epgChannelId is frequently missing on this provider (docs/08-OPEN-QUESTIONS.md
    // OQ-14) — skip those rather than looking up an empty/undefined key.
    if (!epgId || epgId in nowNextByEpgId) continue;
    nowNextByEpgId[epgId] = epgStore.getNowNext(epgId, now);
  }

  // ARCH-R3: only proxied when this page itself is HTTPS and the provider
  // is plain HTTP — checked once per request, not per channel.
  const https = await isRequestHttps();
  const playableChannels = channels.map((channel) => ({
    ...channel,
    streamUrls: resolvePlaybackStreamUrls(channel.streamUrls, https),
  }));

  return (
    <>
      <TopNav />
      <main>
        <GuideGrid
          channels={playableChannels}
          categories={categories}
          nowNextByEpgId={nowNextByEpgId}
          initialPrefs={prefs}
        />
      </main>
    </>
  );
}
