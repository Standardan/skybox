import type { AddonRef, StremioSubtitle } from "../shared/types.js";
import { fetchJson } from "../shared/http.js";
import { getAddonBase, buildResourceUrl } from "./url.js";

/**
 * GET `{base}/subtitles/{type}/{id}.json`, or
 * `{base}/subtitles/{type}/{id}/{extra}.json` when `extra` params are given.
 */
export async function getSubtitles(
  addon: AddonRef,
  type: string,
  id: string,
  extra?: Record<string, string>,
): Promise<StremioSubtitle[]> {
  const base = getAddonBase(addon.transportUrl);
  const url = buildResourceUrl(base, "subtitles", type, id, extra);
  const data = await fetchJson<{ subtitles?: StremioSubtitle[] }>(url);
  return data.subtitles ?? [];
}
