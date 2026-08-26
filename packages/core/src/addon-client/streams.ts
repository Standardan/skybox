import type { AddonRef, StremioStream } from "../shared/types.js";
import { fetchJson } from "../shared/http.js";
import { AddonProtocolError } from "./errors.js";
import { getAddonBase } from "./url.js";

/**
 * GET `{base}/stream/{type}/{id}.json`, e.g. `stream/series/tt0903747:1:1.json`.
 * Each returned stream is tagged with `sourceAddonId` (the addon's manifest id)
 * so downstream aggregation/dedup can trace a stream back to its source.
 */
export async function getStreams(addon: AddonRef, type: string, id: string): Promise<StremioStream[]> {
  if (!addon.manifest) {
    throw new AddonProtocolError(
      `Cannot query streams: addon at ${addon.transportUrl} has no manifest (call fetchManifest first)`,
    );
  }
  const sourceAddonId = addon.manifest.id;
  const base = getAddonBase(addon.transportUrl);
  const url = `${base}/stream/${type}/${id}.json`;
  const data = await fetchJson<{ streams?: StremioStream[] }>(url);
  return (data.streams ?? []).map((stream) => ({ ...stream, sourceAddonId }));
}
