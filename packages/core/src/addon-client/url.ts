/**
 * URL helpers for the Stremio addon protocol.
 *
 * Convention (matches the real Stremio ecosystem): `transportUrl` is the
 * addon's manifest URL itself, e.g. `https://v3-cinemeta.strem.io/manifest.json`.
 * All other resources are fetched relative to that URL with `manifest.json`
 * stripped off. We accept transportUrls with or without the trailing
 * `manifest.json` / slash so callers can pass either form.
 */

/** Resolve the addon's base URL (no trailing slash, no `manifest.json`). */
export function getAddonBase(transportUrl: string): string {
  return transportUrl
    .trim()
    .replace(/\/manifest\.json\/?$/i, "")
    .replace(/\/+$/, "");
}

/**
 * Build the `key=value&key2=value2` path segment Stremio uses for "extra"
 * catalog/subtitles params (search, skip, genre, ...). Keys and values are
 * URL-encoded individually; empty/undefined values are dropped. Returns ""
 * when there's nothing to encode, so callers can skip the segment entirely.
 */
export function buildExtraSegment(extra?: Record<string, string>): string {
  if (!extra) return "";
  const entries = Object.entries(extra).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  if (entries.length === 0) return "";
  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

/** Build a `{base}/{resource}/{type}/{id}[/{extra}].json` addon protocol URL. */
export function buildResourceUrl(
  base: string,
  resource: string,
  type: string,
  id: string,
  extra?: Record<string, string>,
): string {
  const extraSegment = buildExtraSegment(extra);
  const path = extraSegment ? `${resource}/${type}/${id}/${extraSegment}` : `${resource}/${type}/${id}`;
  return `${base}/${path}.json`;
}
