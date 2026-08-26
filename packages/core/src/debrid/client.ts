/** RealDebridClient — the DebridClient implementation for Real-Debrid. */

import type { DebridAuth, DebridAccountStatus, DebridClient, DebridResolveResult } from "../shared/types.js";
import { RD_OPEN_SOURCE_CLIENT_ID, RD_OAUTH_BASE, RD_REST_BASE } from "./constants.js";
import { requestDeviceCode, pollForToken, refreshAccessToken } from "./oauth.js";
import { getAccountStatus } from "./account.js";
import { resolveMagnet, unrestrictLink } from "./torrents.js";
import type { PollOptions } from "./types.js";

export interface RealDebridClientOptions {
  /** OAuth client id to use for the device flow. Defaults to Real-Debrid's public "open source app" id. */
  clientId?: string;
}

export class RealDebridClient implements DebridClient {
  readonly provider = "real-debrid";
  readonly authMethod = "device";
  private readonly clientId: string;

  constructor(options: RealDebridClientOptions = {}) {
    this.clientId = options.clientId ?? RD_OPEN_SOURCE_CLIENT_ID;
  }

  async getAuthUrl(): Promise<{
    verificationUrl: string;
    userCode: string;
    deviceCode: string;
    expiresIn: number;
    interval: number;
  }> {
    return requestDeviceCode(this.clientId);
  }

  async pollForToken(deviceCode: string, options?: PollOptions): Promise<DebridAuth> {
    return pollForToken(deviceCode, { ...options, clientId: this.clientId });
  }

  /** Extra helper beyond the DebridClient interface: refresh an expiring token. */
  async refreshAccessToken(auth: DebridAuth): Promise<DebridAuth> {
    return refreshAccessToken(auth);
  }

  async getAccountStatus(auth: DebridAuth): Promise<DebridAccountStatus> {
    return getAccountStatus(auth);
  }

  async resolveMagnet(auth: DebridAuth, infoHash: string, fileIdx?: number): Promise<DebridResolveResult> {
    return resolveMagnet(auth, infoHash, fileIdx);
  }

  async unrestrictLink(auth: DebridAuth, link: string): Promise<DebridResolveResult> {
    return unrestrictLink(auth, link);
  }
}

// Re-exported for callers that want the raw base URLs (e.g. the proxy layer, ARCH-R2).
export { RD_OAUTH_BASE, RD_REST_BASE };
