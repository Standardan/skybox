/** Wire shapes for the Real-Debrid REST + OAuth APIs, plus local helper types. */

export interface RdDeviceCodeResponse {
  device_code: string;
  user_code: string;
  interval: number;
  expires_in: number;
  verification_url: string;
}

export interface RdDeviceCredentialsResponse {
  client_id: string;
  client_secret: string;
}

export interface RdTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface RdUserResponse {
  id: number;
  username: string;
  email?: string;
  points?: number;
  locale?: string;
  avatar?: string;
  type?: string; // "premium" | "free"
  premium: number; // seconds remaining, 0 if not premium
  expiration?: string;
}

export interface RdAddMagnetResponse {
  id: string;
  uri: string;
}

export type RdTorrentStatus =
  | "magnet_error"
  | "magnet_conversion"
  | "waiting_files_selection"
  | "queued"
  | "downloading"
  | "downloaded"
  | "error"
  | "virus"
  | "compressing"
  | "uploading"
  | "dead";

export interface RdTorrentInfo {
  id: string;
  filename: string;
  status: RdTorrentStatus;
  links: string[];
  [key: string]: unknown;
}

export interface RdUnrestrictLinkResponse {
  id: string;
  filename: string;
  filesize: number;
  link: string;
  host: string;
  download: string;
  streamable: number;
}

/** Shared shape for bounded polling loops (device auth, torrent status). */
export interface PollOptions {
  /** Delay between attempts in ms. */
  intervalMs?: number;
  /** Hard cap on attempts so a poll loop can never run forever. */
  maxAttempts?: number;
  /** Injectable delay fn — tests pass a no-op/fake to avoid real waiting. */
  sleep?: (ms: number) => Promise<void>;
}
