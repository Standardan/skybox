/**
 * In-app update checker (admin-only). Compares the version this instance
 * was built from against the version in the repo's `main` branch on
 * GitHub. Detection only — actually applying an update is a separate,
 * explicit admin action (see apps/web/src/app/api/settings/update/apply/route.ts),
 * never automatic.
 *
 * Deliberately NOT based on `git rev-parse HEAD` baked in at build time —
 * that only works when the Docker build context has a real `.git` folder,
 * which isn't true everywhere (some platforms build from a plain source
 * snapshot for a "public repository" deploy, with no git metadata at all).
 * A plain tracked `VERSION` file at the repo root, bumped on meaningful
 * changes, works regardless of how the source was fetched.
 *
 * Which repo to check defaults to the project's own upstream so this works
 * out of the box for the primary use case, but is overridable
 * (`SKYBOX_UPDATE_REPO=owner/repo`) for anyone running a fork who wants
 * updates checked against their own fork instead.
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_REPO = "Standardan/skybox";
const DEFAULT_VERSION_FILE = "/app/VERSION.txt";
const CHECK_TTL_MS = 10 * 60 * 1000; // don't hit GitHub more than once every 10min

export interface UpdateStatus {
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  repo: string;
  compareUrl: string | null;
  checkedAt: number;
  error: string | null;
}

function getRepo(): string {
  return process.env.SKYBOX_UPDATE_REPO ?? DEFAULT_REPO;
}

/**
 * The version this running instance was built from. Docker deployments
 * have this baked into `VERSION.txt` at build time (a straight copy of the
 * repo's own `VERSION` file — see the Dockerfile); local `pnpm dev` has no
 * such baked file, so it reads the repo's `VERSION` file directly instead.
 */
async function getCurrentVersion(): Promise<string | null> {
  const versionFile = process.env.SKYBOX_VERSION_FILE ?? DEFAULT_VERSION_FILE;
  try {
    const contents = (await fs.readFile(versionFile, "utf8")).trim();
    if (contents) return contents;
  } catch {
    // Not a Docker deployment (no baked VERSION.txt) — fall through.
  }

  try {
    const repoRoot = path.resolve(process.cwd(), "../..");
    const contents = (await fs.readFile(path.join(repoRoot, "VERSION"), "utf8")).trim();
    return contents || null;
  } catch {
    return null;
  }
}

async function getLatestVersion(repo: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${repo}/main/VERSION`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
    const text = (await res.text()).trim();
    if (!text) throw new Error("VERSION file on GitHub was empty");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

let cache: UpdateStatus | null = null;

/** Cached for CHECK_TTL_MS so navigating around Settings doesn't hit GitHub's API on every request. */
export async function checkForUpdate(): Promise<UpdateStatus> {
  if (cache && Date.now() - cache.checkedAt < CHECK_TTL_MS) {
    return cache;
  }

  const repo = getRepo();
  const currentVersion = await getCurrentVersion();

  let latestVersion: string | null = null;
  let error: string | null = null;
  try {
    latestVersion = await getLatestVersion(repo);
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not reach GitHub.";
  }

  const status: UpdateStatus = {
    currentVersion,
    latestVersion,
    updateAvailable: Boolean(currentVersion && latestVersion && currentVersion !== latestVersion),
    repo,
    compareUrl: `https://github.com/${repo}/commits/main`,
    checkedAt: Date.now(),
    error,
  };
  cache = status;
  return status;
}
