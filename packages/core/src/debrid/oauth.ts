/** OAuth2 device-code flow for Real-Debrid, plus refresh + expiry helpers. */

import { fetchJson, HttpError } from "../shared/http.js";
import type { DebridAuth } from "../shared/types.js";
import { RD_OAUTH_BASE, RD_OPEN_SOURCE_CLIENT_ID } from "./constants.js";
import { postFormJson } from "./http.js";
import type { RdDeviceCodeResponse, RdDeviceCredentialsResponse, RdTokenResponse, PollOptions } from "./types.js";

export interface DeviceAuthStart {
  verificationUrl: string;
  userCode: string;
  deviceCode: string;
  expiresIn: number;
  interval: number;
}

/** Step 1: kick off the device flow. Shows the user a code + verification URL. */
export async function requestDeviceCode(
  clientId: string = RD_OPEN_SOURCE_CLIENT_ID,
): Promise<DeviceAuthStart> {
  const url = `${RD_OAUTH_BASE}/device/code?client_id=${encodeURIComponent(clientId)}&new_credentials=yes`;
  const data = await fetchJson<RdDeviceCodeResponse>(url, { method: "POST" });
  return {
    verificationUrl: data.verification_url,
    userCode: data.user_code,
    deviceCode: data.device_code,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

export type DeviceAuthorizationCheck =
  | { authorized: true; clientId: string; clientSecret: string }
  | { authorized: false };

/**
 * Step 2, single attempt: has the user confirmed the code at real-debrid.com/device
 * yet? Real-Debrid answers "not yet" with an error response — that's expected
 * poll-loop state, not a failure, so it's mapped to `{ authorized: false }`
 * rather than thrown. This is the directly-testable "one poll attempt" unit;
 * `pollForToken` below is the loop that repeatedly calls it.
 */
export async function checkDeviceAuthorization(
  deviceCode: string,
  clientId: string = RD_OPEN_SOURCE_CLIENT_ID,
): Promise<DeviceAuthorizationCheck> {
  const url = `${RD_OAUTH_BASE}/device/credentials?client_id=${encodeURIComponent(clientId)}&code=${encodeURIComponent(deviceCode)}`;
  try {
    const data = await fetchJson<RdDeviceCredentialsResponse>(url, { method: "POST" });
    if (data && data.client_id && data.client_secret) {
      return { authorized: true, clientId: data.client_id, clientSecret: data.client_secret };
    }
    return { authorized: false };
  } catch (err) {
    if (err instanceof HttpError) {
      // Real-Debrid responds with a 4xx ("authorization_pending" etc.) while
      // waiting for the user — that's normal poll state, so keep polling.
      return { authorized: false };
    }
    throw err;
  }
}

/**
 * Step 3, single attempt: exchange the now-authorized device code for real
 * access/refresh tokens. Separate from `checkDeviceAuthorization` so each
 * step can be tested in isolation.
 */
export async function exchangeDeviceCode(
  deviceCode: string,
  clientId: string,
  clientSecret: string,
): Promise<DebridAuth> {
  const data = await postFormJson<RdTokenResponse>(`${RD_OAUTH_BASE}/token`, {
    client_id: clientId,
    client_secret: clientSecret,
    code: deviceCode,
    grant_type: "http://oauth.net/grant_type/device/1.0",
  });
  return {
    provider: "real-debrid",
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    clientId,
    clientSecret,
  };
}

/**
 * Loops `checkDeviceAuthorization` on `interval` until the user confirms (then
 * exchanges the code via `exchangeDeviceCode`), or bails out after
 * `maxAttempts`. `sleep` is injectable so tests can drive the loop without
 * real timers/waiting.
 */
export async function pollForToken(
  deviceCode: string,
  options: PollOptions & { clientId?: string } = {},
): Promise<DebridAuth> {
  const {
    intervalMs = 5_000,
    maxAttempts = 60,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    clientId = RD_OPEN_SOURCE_CLIENT_ID,
  } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const check = await checkDeviceAuthorization(deviceCode, clientId);
    if (check.authorized) {
      return exchangeDeviceCode(deviceCode, check.clientId, check.clientSecret);
    }
    if (attempt < maxAttempts - 1) {
      await sleep(intervalMs);
    }
  }
  throw new Error("Timed out waiting for Real-Debrid device authorization");
}

/**
 * Refreshes an expired/expiring access token. Not part of the `DebridClient`
 * interface — exported standalone (and mirrored as a method on
 * `RealDebridClient`) since callers need it wherever they persist auth.
 */
export async function refreshAccessToken(auth: DebridAuth): Promise<DebridAuth> {
  const clientId = auth.clientId ?? RD_OPEN_SOURCE_CLIENT_ID;
  if (!auth.clientSecret || !auth.refreshToken) {
    throw new Error(
      "Cannot refresh Real-Debrid token: no clientSecret/refreshToken on this DebridAuth. " +
        "It must have been persisted from the original device-flow exchange (exchangeDeviceCode/pollForToken).",
    );
  }
  const data = await postFormJson<RdTokenResponse>(`${RD_OAUTH_BASE}/token`, {
    client_id: clientId,
    client_secret: auth.clientSecret,
    code: auth.refreshToken,
    grant_type: "refresh_token",
  });
  return {
    provider: "real-debrid",
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? auth.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    clientId,
    clientSecret: auth.clientSecret,
  };
}

/** True once `auth` is expired or within `skewMs` of expiring (default 30s). API-key providers have no `expiresAt` and never expire. */
export function isTokenExpired(auth: DebridAuth, skewMs = 30_000): boolean {
  if (auth.expiresAt === undefined) return false;
  return Date.now() + skewMs >= auth.expiresAt;
}
