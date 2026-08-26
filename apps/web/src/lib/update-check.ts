/**
 * In-app update checker (admin-only). Compares the commit this instance was
 * built from against the latest commit on GitHub. Detection only — actually
 * applying an update is a separate, explicit admin action (see
 * apps/web/src/app/api/settings/update/apply/route.ts), never automatic.
 *
 * Which repo to check defaults to the project's own upstream so this works
 * out of the box for the primary use case, but is overridable
 * (`SKYBOX_UPDATE_REPO=owner/repo`) for anyone running a fork who wants
 * updates checked against their own fork instead.
 */
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

const DEFAULT_REPO = "Standardan/skybox";
const DEFAULT_VERSION_FILE = "/app/VERSION.txt";
const CHECK_TTL_MS = 60 * 60 * 1000; // don't hit GitHub more than once an hour

export interface UpdateStatus {
  currentSha: string | null;
  latestSha: string | null;
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
 * The commit this running instance was built from. Docker deployments bake
 * this into `VERSION.txt` at build time (no `.git` in the final image);
 * local `pnpm dev` has a real `.git` to ask directly instead.
 */
async function getCurrentSha(): Promise<string | null> {
  const versionFile = process.env.SKYBOX_VERSION_FILE ?? DEFAULT_VERSION_FILE;
  try {
    const contents = (await fs.readFile(versionFile, "utf8")).trim();
    if (contents && contents !== "unknown") return contents;
  } catch {
    // Not a Docker deployment (no baked VERSION.txt) — fall through to git.
  }

  try {
    const repoRoot = path.resolve(process.cwd(), "../..");
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function getLatestSha(repo: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/main`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    const data = (await res.json()) as { sha?: string };
    if (!data.sha) throw new Error("GitHub API response had no sha");
    return data.sha;
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
  const currentSha = await getCurrentSha();

  let latestSha: string | null = null;
  let error: string | null = null;
  try {
    latestSha = await getLatestSha(repo);
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not reach GitHub.";
  }

  const status: UpdateStatus = {
    currentSha,
    latestSha,
    updateAvailable: Boolean(currentSha && latestSha && currentSha !== latestSha),
    repo,
    compareUrl: currentSha && latestSha ? `https://github.com/${repo}/compare/${currentSha}...${latestSha}` : null,
    checkedAt: Date.now(),
    error,
  };
  cache = status;
  return status;
}
