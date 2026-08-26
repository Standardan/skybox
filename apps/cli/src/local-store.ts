/**
 * Local-only credential/token storage for the manual test harness. Everything
 * under repo-root `.local/` is gitignored and never touched by the docs or
 * the app itself — it exists purely so these scripts have somewhere to keep
 * state (a saved Real-Debrid token, cached channel lists) between runs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const LOCAL_DIR = join(__dirname, "..", "..", "..", ".local");

function ensureLocalDir(): void {
  mkdirSync(LOCAL_DIR, { recursive: true });
}

export function localPath(name: string): string {
  return join(LOCAL_DIR, name);
}

export function readLocalJson<T>(name: string): T | null {
  const path = localPath(name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export function writeLocalJson(name: string, value: unknown): void {
  ensureLocalDir();
  writeFileSync(localPath(name), JSON.stringify(value, null, 2));
}
