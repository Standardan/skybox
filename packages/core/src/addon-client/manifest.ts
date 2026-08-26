import type { StremioManifest } from "../shared/types.js";
import { fetchJson, HttpError } from "../shared/http.js";
import { AddonProtocolError } from "./errors.js";
import { getAddonBase } from "./url.js";

const REQUIRED_STRING_FIELDS = ["id", "name", "version"] as const;
const REQUIRED_ARRAY_FIELDS = ["resources", "types"] as const;

function validateManifest(data: unknown, url: string): StremioManifest {
  if (data === null || typeof data !== "object") {
    throw new AddonProtocolError(`Malformed manifest at ${url}: response body is not a JSON object`, url);
  }

  const candidate = data as Record<string, unknown>;
  const missing: string[] = [];

  for (const field of REQUIRED_STRING_FIELDS) {
    const value = candidate[field];
    if (typeof value !== "string" || value.length === 0) missing.push(field);
  }
  for (const field of REQUIRED_ARRAY_FIELDS) {
    if (!Array.isArray(candidate[field])) missing.push(field);
  }

  if (missing.length > 0) {
    throw new AddonProtocolError(
      `Malformed manifest at ${url}: missing or invalid field(s): ${missing.join(", ")}`,
      url,
    );
  }

  return {
    ...candidate,
    catalogs: Array.isArray(candidate.catalogs) ? candidate.catalogs : [],
  } as StremioManifest;
}

/** Fetch and validate `{base}/manifest.json` for a Stremio addon. */
export async function fetchManifest(transportUrl: string): Promise<StremioManifest> {
  const base = getAddonBase(transportUrl);
  const url = `${base}/manifest.json`;

  let data: unknown;
  try {
    data = await fetchJson<unknown>(url);
  } catch (err) {
    if (err instanceof HttpError) {
      throw new AddonProtocolError(`Failed to fetch manifest from ${url}: ${err.message}`, url);
    }
    throw err;
  }

  return validateManifest(data, url);
}
