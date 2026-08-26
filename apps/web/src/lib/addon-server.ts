/**
 * Server-only addon access. Cinemeta (catalog/meta only, no auth) is a
 * built-in always-on source per requirement B1 — distinct from the user's
 * own configured stream-providing addons (Torrentio-style, added via
 * Settings per A2), which start empty on a fresh install (BYO-everything —
 * see docs/01-VISION.md non-goals).
 */
import "server-only";
import { fetchManifest, getCatalog as getCatalogUncached } from "@skybox/core/addon-client";
import type { AddonRef, StremioMetaPreview } from "@skybox/core/shared";
import { readConfig } from "./config-store";

const CINEMETA_TRANSPORT_URL = "https://v3-cinemeta.strem.io/manifest.json";

let cinemetaRef: AddonRef | null = null;

/** The built-in Cinemeta catalog/meta source — always available, never user-removable. */
export async function getCinemetaAddon(): Promise<AddonRef> {
  if (cinemetaRef) return cinemetaRef;
  const manifest = await fetchManifest(CINEMETA_TRANSPORT_URL);
  cinemetaRef = { transportUrl: CINEMETA_TRANSPORT_URL, manifest, enabled: true, order: -1 };
  return cinemetaRef;
}

const CATALOG_TTL_MS = 5 * 60 * 1000;
const catalogCache = new Map<string, { entries: StremioMetaPreview[]; fetchedAt: number }>();

/**
 * `getCatalog` with a short in-memory TTL. Home alone fires the "top"
 * catalog for movie and series on every load with no caching, unlike the
 * IPTV/EPG data (iptv-server.ts's own TTL cache) — catalog rails don't need
 * to be second-fresh, so this trades a few minutes of staleness for
 * removing a real, avoidable multi-second Cinemeta round trip per view.
 */
export async function getCachedCatalog(
  addon: AddonRef,
  type: string,
  id: string,
  extra?: Record<string, string>,
): Promise<StremioMetaPreview[]> {
  const key = `${addon.transportUrl}:${type}:${id}:${JSON.stringify(extra ?? {})}`;
  const cached = catalogCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) return cached.entries;

  const entries = await getCatalogUncached(addon, type, id, extra);
  catalogCache.set(key, { entries, fetchedAt: Date.now() });
  return entries;
}

/** The user's own configured, enabled stream-providing addons (initially empty). */
export async function getStreamAddons(): Promise<AddonRef[]> {
  const config = await readConfig();
  return config.addons.filter((addon) => addon.enabled).sort((a, b) => a.order - b.order);
}
