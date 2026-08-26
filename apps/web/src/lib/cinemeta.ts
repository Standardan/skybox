/**
 * Cinemeta's own poster/background CDN (images.metahub.space) — the only
 * remote image host allowlisted in next.config.js's `images.remotePatterns`.
 *
 * Cinemeta's catalog/meta/search responses sometimes point their `poster`
 * field at other CDNs instead (observed: `m.media-amazon.com` for search
 * results, `live.metahub.space` for a handful of catalog entries). Passing
 * those straight to next/image throws at render time ("hostname is not
 * configured") since next.config.js is off-limits to edit for this task.
 *
 * Cinemeta serves both poster and background deterministically by IMDB id
 * on `images.metahub.space`, so we always derive the URL from the id
 * instead of trusting whatever CDN a given response field happened to use.
 * This keeps every poster/background inside the one allowlisted host.
 */

export type CinemetaImageSize = "small" | "medium" | "large";

export function cinemetaPosterUrl(imdbId: string, size: CinemetaImageSize = "medium"): string {
  return `https://images.metahub.space/poster/${size}/${imdbId}/img`;
}

export function cinemetaBackgroundUrl(imdbId: string, size: CinemetaImageSize = "large"): string {
  return `https://images.metahub.space/background/${size}/${imdbId}/img`;
}
