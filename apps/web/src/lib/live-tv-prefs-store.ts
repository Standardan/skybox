/**
 * Server-only persistence for per-account Live TV customization: favorite
 * channels and manual category/channel ordering. Per-user (D-020), same
 * reasoning and same one-file-keyed-by-userId pattern as library-store.ts —
 * different people care about different channels, the same way each
 * account's watch history is its own.
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./data-dir";

const LOCAL_DIR = getDataDir();
const PREFS_PATH = path.join(LOCAL_DIR, "live-tv-prefs.json");

export interface LiveTvPrefs {
  /** Ordered — array order IS favorites order, directly reorderable. `${providerId}:${channelId}` keys, matching GuideGrid's channelKey(). */
  favoriteChannelKeys: string[];
  /** Explicit category ids the user has arranged; anything else keeps provider order, appended after (see applyCustomOrder). */
  categoryOrder: string[];
  /** categoryId -> explicit channelKeys the user has arranged within that one category. Only categories a user actually reorders get an entry. */
  channelOrder: Record<string, string[]>;
}

const EMPTY_PREFS: LiveTvPrefs = { favoriteChannelKeys: [], categoryOrder: [], channelOrder: {} };

type PrefsByUser = Record<string, LiveTvPrefs>;

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readAll(): Promise<PrefsByUser> {
  return (await readJsonIfExists<PrefsByUser>(PREFS_PATH)) ?? {};
}

let writeQueue: Promise<unknown> = Promise.resolve();

export async function readLiveTvPrefs(userId: string): Promise<LiveTvPrefs> {
  const byUser = await readAll();
  return byUser[userId] ?? EMPTY_PREFS;
}

/** Serialized read-merge-write through the same queue as the write itself — see library-store.ts's writeLibrary for why. */
export function updateLiveTvPrefs(
  userId: string,
  mutate: (prefs: LiveTvPrefs) => LiveTvPrefs,
): Promise<LiveTvPrefs> {
  let result!: LiveTvPrefs;
  writeQueue = writeQueue.then(async () => {
    const byUser = await readAll();
    result = mutate(byUser[userId] ?? EMPTY_PREFS);
    const next = { ...byUser, [userId]: result };
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    const tmpPath = `${PREFS_PATH}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(tmpPath, PREFS_PATH);
  });
  return writeQueue.then(() => result);
}
