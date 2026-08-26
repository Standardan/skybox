/**
 * Zero-credential sanity check: proves the addon-client module works against
 * a real Stremio addon over the real network (Cinemeta needs no auth), not
 * just mocked fetches. Good first thing to run — if this fails, the problem
 * is network/DNS, not your Real-Debrid or IPTV setup.
 *
 *   pnpm -F @skybox/cli run check:cinemeta
 */
import { fetchManifest, getMeta, getCatalog } from "@skybox/core/addon-client";
import type { AddonRef } from "@skybox/core/shared";

const transportUrl = "https://v3-cinemeta.strem.io";

console.log(`Fetching manifest: ${transportUrl}/manifest.json`);
const manifest = await fetchManifest(transportUrl);
console.log(`  -> ${manifest.name} v${manifest.version} (${manifest.id})`);

const addon: AddonRef = { transportUrl, manifest, enabled: true, order: 0 };

console.log("\nFetching catalog: movie/top");
const catalog = await getCatalog(addon, "movie", "top");
console.log(`  -> ${catalog.length} entries, first: "${catalog[0]?.name}" (${catalog[0]?.id})`);

console.log("\nFetching meta: movie/tt0111161");
const meta = await getMeta(addon, "movie", "tt0111161");
console.log(`  -> "${meta.name}" (${meta.releaseInfo})`);

console.log("\naddon-client: OK — real network round-trip confirmed.");
