/**
 * Server-only debrid access: wraps whichever DebridClient the user has
 * configured (Real-Debrid, AllDebrid, Premiumize, or TorBox) with the
 * persisted DebridAuth from config-store, refreshing the token when it's
 * close to expiry (device-flow providers only) so callers never have to
 * think about auth directly.
 */
import "server-only";
import { createDebridClient, RealDebridClient } from "@skybox/core/debrid";
import type { DebridAuth, DebridAccountStatus, DebridResolveResult, DebridProviderId } from "@skybox/core/shared";
import { readConfig, updateConfig } from "./config-store";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

async function getFreshAuth(): Promise<DebridAuth | null> {
  const config = await readConfig();
  if (!config.debrid) return null;

  // Only Real-Debrid's device flow issues a refreshable token; other
  // providers' auth (AllDebrid pin-issued key, Premiumize/TorBox API keys)
  // doesn't expire, so there's nothing to refresh.
  if (config.debrid.provider !== "real-debrid" || config.debrid.expiresAt === undefined) {
    return config.debrid;
  }
  if (config.debrid.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return config.debrid;
  }
  if (!config.debrid.clientId || !config.debrid.clientSecret) {
    // Can't refresh without the dynamically-issued client id/secret from the
    // original device-flow exchange — fall back to the possibly-stale token
    // rather than throwing; the caller's request will surface the real 401.
    return config.debrid;
  }

  const client = new RealDebridClient();
  const refreshed = await client.refreshAccessToken(config.debrid);
  await updateConfig((c) => ({ ...c, debrid: refreshed }));
  return refreshed;
}

export async function isDebridConnected(): Promise<boolean> {
  const config = await readConfig();
  return config.debrid !== null;
}

export async function getDebridProvider(): Promise<DebridProviderId | null> {
  const config = await readConfig();
  return config.debrid?.provider ?? null;
}

export async function getDebridAccountStatus(): Promise<DebridAccountStatus | null> {
  const auth = await getFreshAuth();
  if (!auth) return null;
  return createDebridClient(auth.provider).getAccountStatus(auth);
}

export async function resolveDebridSource(
  infoHash: string,
  fileIdx?: number,
): Promise<DebridResolveResult | null> {
  const auth = await getFreshAuth();
  if (!auth) return null;
  return createDebridClient(auth.provider).resolveMagnet(auth, infoHash, fileIdx);
}

export async function unrestrictDebridLink(link: string): Promise<DebridResolveResult | null> {
  const auth = await getFreshAuth();
  if (!auth) return null;
  return createDebridClient(auth.provider).unrestrictLink(auth, link);
}

// Re-exported for the connect-flow API route, which needs a client for a
// provider the user is *connecting* (before any DebridAuth exists in config).
export { createDebridClient };
