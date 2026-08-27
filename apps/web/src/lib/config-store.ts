/**
 * Server-only config persistence for the self-hosted instance.
 *
 * `Config` is household-level (debrid/addons/IPTV/sports/UI/playback) —
 * shared by every account on this instance (D-017: one instance, one
 * config; D-020: per-user state is limited to watch history, see
 * user-store.ts/library-store.ts). It lives as a JSON file in the data
 * directory (see data-dir.ts) — locally, the repo's gitignored `.local/`,
 * the same place the manual test harness (apps/cli) keeps its own
 * debrid/Xtream credentials for real-API verification. On first read, this
 * seeds itself from those existing files so the app comes up already
 * connected.
 *
 * Never import this from a Client Component — it touches the filesystem
 * and real credentials.
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { Config, DebridAuth, XtreamCredentials } from "@skybox/core/shared";
import { getDataDir } from "./data-dir";

const LOCAL_DIR = getDataDir();
const CONFIG_PATH = path.join(LOCAL_DIR, "app-config.json");
const LEGACY_RD_AUTH_PATH = path.join(LOCAL_DIR, "rd-auth.json");
const LEGACY_IPTV_CREDS_PATH = path.join(LOCAL_DIR, "iptv-credentials.json");

function defaultConfig(): Config {
  return {
    addons: [],
    debrid: null,
    iptv: [],
    sports: { enabled: true, leagues: [], teams: [], spoilerFree: false, channelOverrides: {}, teamChannelHints: {} },
    ui: {
      railOrder: ["today-games", "continue-watching", "favorite-channels", "popular-movies", "popular-series"],
      hiddenRails: [],
      sportsFirst: true,
    },
    playback: { preferCached: true, preferredResolution: "any", preferredLanguage: "any" },
  };
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** One-time migration from the apps/cli proof-harness files into Config shape. */
async function seedFromLegacyFiles(): Promise<Config> {
  const config = defaultConfig();

  const rdAuth = await readJsonIfExists<DebridAuth>(LEGACY_RD_AUTH_PATH);
  if (rdAuth) config.debrid = rdAuth;

  const iptvCreds = await readJsonIfExists<{ baseUrls: string[]; username: string; password: string }>(
    LEGACY_IPTV_CREDS_PATH,
  );
  if (iptvCreds) {
    const provider: XtreamCredentials = {
      type: "xtream",
      id: "primary",
      label: "My IPTV",
      baseUrls: iptvCreds.baseUrls,
      username: iptvCreds.username,
      password: iptvCreds.password,
      hiddenCategories: [],
    };
    config.iptv = [provider];
  }

  return config;
}

let writeQueue: Promise<unknown> = Promise.resolve();

export async function readConfig(): Promise<Config> {
  const existing = await readJsonIfExists<Partial<Config>>(CONFIG_PATH);
  if (existing) {
    // Backfill fields added after this file was first written (e.g.
    // `playback`, `sports.teamChannelHints`, added later) so older on-disk
    // configs don't crash code that assumes the current full shape.
    const defaults = defaultConfig();
    const merged: Config = {
      ...defaults,
      ...existing,
      playback: { ...defaults.playback, ...existing.playback },
      sports: { ...defaults.sports, ...existing.sports },
    };
    if (!existing.playback || !existing.sports?.teamChannelHints) await writeConfig(merged);
    return merged;
  }

  const seeded = await seedFromLegacyFiles();
  await writeConfig(seeded);
  return seeded;
}

/** Serialized writes so concurrent Settings saves can't interleave and corrupt the file. */
export function writeConfig(config: Config): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    const tmpPath = `${CONFIG_PATH}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), "utf8");
    await fs.rename(tmpPath, CONFIG_PATH);
  });
  return writeQueue as Promise<void>;
}

export async function updateConfig(mutate: (config: Config) => Config): Promise<Config> {
  const current = await readConfig();
  const next = mutate(current);
  await writeConfig(next);
  return next;
}
