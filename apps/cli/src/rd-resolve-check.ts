/**
 * Proves the debrid module's resolveMagnet() pipeline (addMagnet ->
 * selectFiles -> poll info -> unrestrict) against the real Real-Debrid API,
 * using any infoHash you pass — defaults to Ubuntu's official ISO torrent (a
 * well-known legal, well-seeded test case) so it works with zero setup.
 *
 *   pnpm -F @skybox/cli run resolve:rd [infoHash]
 */
const UBUNTU_24_04_3_DESKTOP_INFOHASH = "d160b8d8ea35a5b4e52837468fc8f03d55cef1f7";
import { RealDebridClient } from "@skybox/core/debrid";
import type { DebridAuth } from "@skybox/core/shared";
import { readLocalJson } from "./local-store.js";

const infoHash = process.argv[2] || UBUNTU_24_04_3_DESKTOP_INFOHASH;

const auth = readLocalJson<DebridAuth>("rd-auth.json");
if (!auth) {
  console.error("No saved Real-Debrid auth. Run auth-rd.ts first.");
  process.exit(1);
}

const client = new RealDebridClient();
console.log(`Resolving infoHash ${infoHash} via Real-Debrid...`);
const result = await client.resolveMagnet(auth, infoHash);
console.log("\nResolved:");
console.log("  filename:", result.filename);
console.log("  size:", result.filesizeBytes ? `${(result.filesizeBytes / 1e9).toFixed(2)} GB` : "unknown");
console.log("  playableUrl:", result.playableUrl);

const controller = new AbortController();
setTimeout(() => controller.abort(), 8000);
const res = await fetch(result.playableUrl, { signal: controller.signal, headers: { Range: "bytes=0-1023" } });
console.log(`\nProbe: HTTP ${res.status}, content-type: ${res.headers.get("content-type")}, content-length: ${res.headers.get("content-length")}`);
