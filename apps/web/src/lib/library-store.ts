/**
 * Server-only persistence for `LibraryItem[]` (Continue Watching / watched /
 * watchlist — REQUIREMENTS B7-B9). `packages/core/src/library/library.ts`
 * has the pure state-transition logic already; this file is just the JSON
 * file it was always missing, same pattern as config-store.ts.
 *
 * Per-user (D-020): each account's watch history is independent, unlike
 * Config (household-level, shared). One file keyed by userId rather than
 * one file per user — simpler, one write queue, no risk of the user count
 * growing into a directory full of tiny files.
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { LibraryItem } from "@skybox/core/shared";
import { getDataDir } from "./data-dir";

const LOCAL_DIR = getDataDir();
const LIBRARY_PATH = path.join(LOCAL_DIR, "library.json");

type LibraryByUser = Record<string, LibraryItem[]>;

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readAll(): Promise<LibraryByUser> {
  return (await readJsonIfExists<LibraryByUser>(LIBRARY_PATH)) ?? {};
}

let writeQueue: Promise<unknown> = Promise.resolve();

export async function readLibrary(userId: string): Promise<LibraryItem[]> {
  const byUser = await readAll();
  return byUser[userId] ?? [];
}

/**
 * Serialized read-merge-write per call, chained through the same queue —
 * not just the write. Two different users' progress updates can arrive
 * concurrently; reading the shared map outside the queue would let the
 * second writer's stale snapshot silently clobber the first writer's key.
 */
export function writeLibrary(userId: string, items: LibraryItem[]): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const byUser = await readAll();
    const next = { ...byUser, [userId]: items };
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    const tmpPath = `${LIBRARY_PATH}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(tmpPath, LIBRARY_PATH);
  });
  return writeQueue as Promise<void>;
}

export async function updateLibrary(
  userId: string,
  mutate: (items: LibraryItem[]) => LibraryItem[],
): Promise<LibraryItem[]> {
  const current = await readLibrary(userId);
  const next = mutate(current);
  await writeLibrary(userId, next);
  return next;
}
