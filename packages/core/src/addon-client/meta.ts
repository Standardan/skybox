import type { AddonRef, StremioMeta } from "../shared/types.js";
import { fetchJson } from "../shared/http.js";
import { AddonProtocolError } from "./errors.js";
import { getAddonBase } from "./url.js";

/** GET `{base}/meta/{type}/{id}.json` — full metadata incl. `videos[]` (episodes). */
export async function getMeta(addon: AddonRef, type: string, id: string): Promise<StremioMeta> {
  const base = getAddonBase(addon.transportUrl);
  const url = `${base}/meta/${type}/${id}.json`;
  const data = await fetchJson<{ meta?: StremioMeta }>(url);
  if (!data.meta) {
    throw new AddonProtocolError(`Addon returned no "meta" object for ${type}/${id}`, url);
  }
  return data.meta;
}
