/**
 * One-shot status summary across everything the harness can check without
 * arguments: Real-Debrid auth state and (if configured) IPTV connectivity.
 * Run the more targeted scripts (auth-rd, check-iptv, resolve-stream) for
 * anything this doesn't cover.
 */
import { RealDebridClient, isTokenExpired } from "@skybox/core/debrid";
import { createIptvClient, XtreamClient } from "@skybox/core/iptv";
import type { DebridAuth, XtreamCredentials } from "@skybox/core/shared";
import { readLocalJson } from "./local-store.js";

interface RawIptvCredentials {
  baseUrl?: string;
  baseUrls?: string[];
  username: string;
  password: string;
}

async function checkRealDebrid(): Promise<void> {
  const auth = readLocalJson<DebridAuth>("rd-auth.json");
  if (!auth) {
    console.log("Real-Debrid: not authorized. Run: pnpm -F @skybox/cli run auth:rd -- start");
    return;
  }
  if (isTokenExpired(auth)) {
    console.log("Real-Debrid: token expired (will auto-refresh on next real use).");
    return;
  }
  try {
    const status = await new RealDebridClient().getAccountStatus(auth);
    console.log(`Real-Debrid: OK — ${status.username} (${status.type})`);
  } catch (err) {
    console.log(`Real-Debrid: token present but account check failed — ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function checkIptv(): Promise<void> {
  const raw = readLocalJson<RawIptvCredentials>("iptv-credentials.json");
  if (!raw) {
    console.log(`IPTV: not configured. Create .local/iptv-credentials.json, see check-iptv.ts header comment.`);
    return;
  }
  const baseUrls = (raw.baseUrls ?? (raw.baseUrl ? [raw.baseUrl] : [])).map((u) => u.replace(/\/+$/, ""));
  const credentials: XtreamCredentials = {
    type: "xtream",
    id: "primary",
    label: "Primary IPTV",
    baseUrls,
    username: raw.username,
    password: raw.password,
    hiddenCategories: [],
  };
  try {
    const client = createIptvClient(credentials);
    const valid = await client.validate();
    if (!valid) {
      console.log("IPTV: credentials present but auth failed.");
      return;
    }
    const channels = await client.getChannels();
    const active = client instanceof XtreamClient ? client.getActiveBaseUrl() : null;
    console.log(`IPTV: OK — ${channels.length} channels reachable (${baseUrls.length} mirror(s) configured${active ? `, via ${active}` : ""})`);
  } catch (err) {
    console.log(`IPTV: check failed — ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("Skybox backbone smoke check\n" + "=".repeat(30));
await checkRealDebrid();
await checkIptv();
console.log("\nFor on-demand stream resolution, run: pnpm -F @skybox/cli run resolve:stream -- <addonManifestUrl> <type> <id>");
