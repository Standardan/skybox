/**
 * Validates a real Xtream Codes IPTV connection (across all configured
 * mirrors — see the iptv module's mirror-failover XtreamClient) and lists
 * what it returns.
 *
 * Credentials are read from .local/iptv-credentials.json (gitignored, create
 * it yourself — this script never prompts for or logs the password):
 *
 *   { "baseUrls": ["http://mirror1", "http://mirror2", ...], "username": "...", "password": "..." }
 *
 * A single "baseUrl" string is also accepted for convenience. Env vars
 * IPTV_BASE_URL / IPTV_USERNAME / IPTV_PASSWORD work as a fallback (single
 * mirror only).
 */
import { createIptvClient, MirrorFailoverError, XtreamClient } from "@skybox/core/iptv";
import type { XtreamCredentials, Channel } from "@skybox/core/shared";
import { readLocalJson, writeLocalJson, localPath } from "./local-store.js";

interface RawIptvCredentials {
  baseUrl?: string;
  baseUrls?: string[];
  username: string;
  password: string;
}

function loadCredentials(): XtreamCredentials {
  const fromFile = readLocalJson<RawIptvCredentials>("iptv-credentials.json");
  const raw: RawIptvCredentials | null =
    fromFile ??
    (process.env.IPTV_BASE_URL && process.env.IPTV_USERNAME && process.env.IPTV_PASSWORD
      ? {
          baseUrl: process.env.IPTV_BASE_URL,
          username: process.env.IPTV_USERNAME,
          password: process.env.IPTV_PASSWORD,
        }
      : null);

  if (!raw) {
    console.error(
      `No IPTV credentials found. Create ${localPath("iptv-credentials.json")} with:\n` +
        `  { "baseUrls": ["http://mirror1", "http://mirror2"], "username": "...", "password": "..." }\n` +
        `(or set IPTV_BASE_URL / IPTV_USERNAME / IPTV_PASSWORD env vars)`,
    );
    process.exit(1);
  }

  const baseUrls = (raw.baseUrls ?? (raw.baseUrl ? [raw.baseUrl] : [])).map((u) => u.replace(/\/+$/, ""));
  if (baseUrls.length === 0) {
    console.error(`iptv-credentials.json has no "baseUrls" (or "baseUrl").`);
    process.exit(1);
  }

  return {
    type: "xtream",
    id: "primary",
    label: "Primary IPTV",
    baseUrls,
    username: raw.username,
    password: raw.password,
    hiddenCategories: [],
  };
}

/** Bounded reachability probe: confirm the stream URL responds without downloading it. */
async function probeStreamUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const contentType = res.headers.get("content-type") ?? "unknown";
    // Drain a small amount of the body so we know data is actually flowing,
    // then bail — we don't want to pull down a live stream indefinitely.
    const reader = res.body?.getReader();
    let receivedBytes = 0;
    if (reader) {
      const { value } = await reader.read();
      receivedBytes = value?.byteLength ?? 0;
      await reader.cancel();
    }
    return `HTTP ${res.status}, content-type: ${contentType}, first chunk: ${receivedBytes} bytes`;
  } catch (err) {
    return `unreachable (${err instanceof Error ? err.message : String(err)})`;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const credentials = loadCredentials();
  const client = createIptvClient(credentials);

  console.log(`Validating against ${credentials.baseUrls.length} mirror(s):\n  ${credentials.baseUrls.join("\n  ")}\n`);
  let valid: boolean;
  try {
    valid = await client.validate();
  } catch (err) {
    if (err instanceof MirrorFailoverError) {
      console.error(`All ${err.baseUrls.length} mirrors unreachable:\n${err.baseUrls.map((u, i) => `  ${u} — ${String(err.causes[i] ?? "no response")}`).join("\n")}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  if (!valid) {
    console.error("Xtream auth failed — a mirror responded but rejected the username/password.");
    process.exitCode = 1;
    return;
  }
  const active = client instanceof XtreamClient ? client.getActiveBaseUrl() : null;
  console.log(`Auth OK${active ? ` (via ${active})` : ""}.\n`);

  const categories = await client.getCategories();
  console.log(`Categories: ${categories.length}`);

  const channels = await client.getChannels();
  console.log(`Channels: ${channels.length}\n`);

  writeLocalJson("iptv-channels.json", channels);
  console.log(`Full channel list cached to ${localPath("iptv-channels.json")} (for the sports-matching test).\n`);

  const sample: Channel[] = channels.slice(0, 5);
  console.log("Sample channels:");
  for (const ch of sample) {
    console.log(`  [${ch.category}] ${ch.name} (epgId: ${ch.epgChannelId ?? "none"})`);
  }

  if (sample[0]) {
    console.log(`\nProbing stream reachability for "${sample[0].name}" (bounded, won't download the full stream)...`);
    console.log(" ", await probeStreamUrl(sample[0].streamUrl));
  }
}

await main();
