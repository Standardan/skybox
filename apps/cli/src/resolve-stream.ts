/**
 * End-to-end on-demand resolution: query a real Stremio addon for streams,
 * resolve one to a playable URL (via Real-Debrid if it's a magnet/infoHash,
 * pass-through if the addon already returned a direct RD-resolved URL), and
 * probe that it's actually reachable.
 *
 *   pnpm -F @skybox/cli run resolve:stream -- <addonManifestUrl> <type> <id> [streamIndex]
 *
 * Example (Cinemeta has no streams, so use a stream-providing addon):
 *   pnpm -F @skybox/cli run resolve:stream -- https://torrentio.strem.fun/manifest.json movie tt0111161
 *
 * Requires a saved Real-Debrid token (run auth-rd.ts first) only if the
 * chosen stream is a raw magnet/infoHash rather than an addon-resolved URL.
 */
import { fetchManifest, getStreams } from "@skybox/core/addon-client";
import { RealDebridClient, isTokenExpired, refreshAccessToken } from "@skybox/core/debrid";
import type { AddonRef, DebridAuth, StremioStream } from "@skybox/core/shared";
import { readLocalJson, writeLocalJson } from "./local-store.js";

async function probeUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Range: "bytes=0-1023" } });
    return `HTTP ${res.status}, content-type: ${res.headers.get("content-type") ?? "unknown"}, content-length: ${res.headers.get("content-length") ?? "unknown"}`;
  } catch (err) {
    return `unreachable (${err instanceof Error ? err.message : String(err)})`;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const [transportUrl, type, id, streamIndexArg] = process.argv.slice(2);
  if (!transportUrl || !type || !id) {
    console.error("Usage: resolve:stream -- <addonManifestUrl> <type> <id> [streamIndex]");
    process.exitCode = 1;
    return;
  }
  const streamIndex = streamIndexArg ? Number(streamIndexArg) : 0;

  console.log(`Fetching manifest: ${transportUrl}`);
  const manifest = await fetchManifest(transportUrl);
  console.log(`  -> ${manifest.name} v${manifest.version} (${manifest.id})`);

  const addon: AddonRef = { transportUrl, manifest, enabled: true, order: 0 };
  console.log(`\nQuerying streams for ${type}/${id} ...`);
  const streams: StremioStream[] = await getStreams(addon, type, id);
  console.log(`  -> ${streams.length} stream(s) found`);

  if (streams.length === 0) {
    console.log("No streams returned — nothing to resolve.");
    return;
  }

  streams.slice(0, 10).forEach((s, i) => {
    console.log(`  [${i}] ${s.name ?? ""} ${(s.title ?? "").split("\n")[0]}${s.url ? " (direct url)" : s.infoHash ? " (magnet)" : ""}`);
  });

  const chosen = streams[streamIndex];
  if (!chosen) {
    console.error(`No stream at index ${streamIndex} (have ${streams.length}).`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nResolving stream [${streamIndex}]: ${chosen.name ?? ""} ${(chosen.title ?? "").split("\n")[0]}`);

  let playableUrl: string;
  if (chosen.url) {
    console.log("Addon already returned a direct URL — no debrid resolution needed.");
    playableUrl = chosen.url;
  } else if (chosen.infoHash) {
    let auth = readLocalJson<DebridAuth>("rd-auth.json");
    if (!auth) {
      console.error("This stream is a magnet and needs Real-Debrid. Run: pnpm -F @skybox/cli run auth:rd -- start (then poll)");
      process.exitCode = 1;
      return;
    }
    if (isTokenExpired(auth)) {
      console.log("Saved RD token expired — refreshing...");
      auth = await refreshAccessToken(auth);
      writeLocalJson("rd-auth.json", auth);
    }
    const client = new RealDebridClient();
    console.log(`Resolving magnet ${chosen.infoHash} via Real-Debrid (this can take a while if the torrent isn't already cached)...`);
    const resolved = await client.resolveMagnet(auth, chosen.infoHash, chosen.fileIdx);
    console.log(`  -> ${resolved.filename} (${resolved.filesizeBytes ? Math.round(resolved.filesizeBytes / 1e6) + " MB" : "size unknown"})`);
    playableUrl = resolved.playableUrl;
  } else {
    console.error("Stream has neither a direct url nor an infoHash — can't resolve.");
    process.exitCode = 1;
    return;
  }

  console.log(`\nPlayable URL: ${playableUrl}`);
  console.log("Probing reachability (small ranged request, won't download the file)...");
  console.log(" ", await probeUrl(playableUrl));
}

await main();
