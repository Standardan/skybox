/** Public surface of the debrid module (ARCH: debrid). See docs/04-INTEGRATIONS.md §2. */

export { RD_REST_BASE, RD_OAUTH_BASE, RD_OPEN_SOURCE_CLIENT_ID } from "./constants.js";

export type {
  RdDeviceCodeResponse,
  RdDeviceCredentialsResponse,
  RdTokenResponse,
  RdUserResponse,
  RdAddMagnetResponse,
  RdTorrentStatus,
  RdTorrentInfo,
  RdUnrestrictLinkResponse,
  PollOptions,
} from "./types.js";

export { postFormJson, postFormVoid } from "./http.js";
export type { PostFormOptions } from "./http.js";

export {
  requestDeviceCode,
  checkDeviceAuthorization,
  exchangeDeviceCode,
  pollForToken,
  refreshAccessToken,
  isTokenExpired,
} from "./oauth.js";
export type { DeviceAuthStart, DeviceAuthorizationCheck } from "./oauth.js";

export { getAccountStatus } from "./account.js";

export {
  addMagnet,
  selectFiles,
  getTorrentInfo,
  waitForTorrentDownload,
  unrestrictLink,
  resolveMagnet,
} from "./torrents.js";

export { RealDebridClient } from "./client.js";
export type { RealDebridClientOptions } from "./client.js";

export { AllDebridClient, ALLDEBRID_API_BASE } from "./alldebrid.js";
export { PremiumizeClient, PREMIUMIZE_API_BASE } from "./premiumize.js";
export { TorboxClient, TORBOX_API_BASE } from "./torbox.js";
export { createDebridClient, DEBRID_PROVIDERS } from "./factory.js";
