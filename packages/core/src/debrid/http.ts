/**
 * Local form-urlencoded POST helper for Real-Debrid's mutating endpoints
 * (addMagnet, selectFiles, unrestrict/link, oauth token exchange). Real-Debrid
 * expects `application/x-www-form-urlencoded` bodies rather than JSON, and
 * some endpoints (selectFiles) return an empty body — neither is what
 * shared `fetchJson` handles, so this stays local to the debrid module.
 * Still throws the shared `HttpError` on non-2xx responses so callers can
 * handle failures uniformly across modules.
 */

import { HttpError } from "../shared/http.js";

export interface PostFormOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

async function doPostForm(
  url: string,
  params: Record<string, string>,
  options: PostFormOptions,
): Promise<Response> {
  const { headers = {}, timeoutMs = 15_000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new HttpError(`Request failed: ${res.status} ${res.statusText}`, res.status, url);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** POST a form body and parse a JSON response. */
export async function postFormJson<T>(
  url: string,
  params: Record<string, string>,
  options: PostFormOptions = {},
): Promise<T> {
  const res = await doPostForm(url, params, options);
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

/** POST a form body, discarding any response body (RD returns empty/204 for e.g. selectFiles). */
export async function postFormVoid(
  url: string,
  params: Record<string, string>,
  options: PostFormOptions = {},
): Promise<void> {
  await doPostForm(url, params, options);
}
