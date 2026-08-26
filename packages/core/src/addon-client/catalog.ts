import type { AddonRef, StremioMetaPreview } from "../shared/types.js";
import { fetchJson } from "../shared/http.js";
import { getAddonBase, buildResourceUrl } from "./url.js";

/**
 * GET `{base}/catalog/{type}/{id}.json`, or
 * `{base}/catalog/{type}/{id}/{extra}.json` when `extra` params are given
 * (e.g. `{ search: "matrix" }`, `{ skip: "20" }`, `{ genre: "Action" }`).
 */
export async function getCatalog(
  addon: AddonRef,
  type: string,
  id: string,
  extra?: Record<string, string>,
): Promise<StremioMetaPreview[]> {
  const base = getAddonBase(addon.transportUrl);
  const url = buildResourceUrl(base, "catalog", type, id, extra);
  const data = await fetchJson<{ metas?: StremioMetaPreview[] }>(url);
  return data.metas ?? [];
}

/** `getCatalog` with a `search` extra param — what "search" boxes call. */
export async function catalogSearch(
  addon: AddonRef,
  type: string,
  catalogId: string,
  query: string,
): Promise<StremioMetaPreview[]> {
  return getCatalog(addon, type, catalogId, { search: query });
}
