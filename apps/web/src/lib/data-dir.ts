/**
 * Where every server-only store (config, library, users) persists its JSON
 * files. Defaults to `.local/` at the repo root for local dev (`pnpm dev`/
 * `next start` always run with cwd = apps/web, so two levels up is the
 * monorepo root). A Docker deployment sets
 * `SKYBOX_DATA_DIR` to a mounted volume instead, since the standalone
 * build's cwd doesn't reliably land on that same relative path.
 */
import "server-only";
import path from "node:path";

export function getDataDir(): string {
  return process.env.SKYBOX_DATA_DIR ?? path.resolve(process.cwd(), "../..", ".local");
}
