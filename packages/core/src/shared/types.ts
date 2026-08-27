/**
 * Shared data model for @skybox/core. Every module (addon-client, debrid, iptv,
 * epg, sports, library, sync) imports from here rather than redefining these
 * shapes. See docs/03-ARCHITECTURE.md "Data model" for the source spec.
 */

// ---------------------------------------------------------------------------
// Identity / media
// ---------------------------------------------------------------------------

/** IMDB-style id ("tt1234567") — the universal key across Stremio addons. */
export type ImdbId = string;

export type MediaType = "movie" | "series" | "channel" | "tv" | "other";

// ---------------------------------------------------------------------------
// Config (persisted, synced)
// ---------------------------------------------------------------------------

export interface AddonRef {
  transportUrl: string;
  manifest: StremioManifest | null;
  enabled: boolean;
  order: number;
}

export type DebridProviderId = "real-debrid" | "alldebrid" | "premiumize" | "torbox";

export interface DebridAuth {
  provider: DebridProviderId;
  /** Sent on every authenticated request — an OAuth access token (Real-Debrid, AllDebrid) or a long-lived account API key (Premiumize, TorBox). */
  accessToken: string;
  /** Real-Debrid/AllDebrid only: rotates on refresh. Absent for API-key providers. */
  refreshToken?: string;
  /** Real-Debrid/AllDebrid only: epoch ms the accessToken expires. Absent for API-key providers, which don't expire. */
  expiresAt?: number;
  /**
   * Real-Debrid's device flow dynamically issues a client_id/client_secret pair
   * (distinct from the public "open source app" id used to start the flow) that
   * persists for the life of the authorization — it's required again on every
   * token refresh, not just the initial exchange, so both must be persisted.
   * Real-Debrid only.
   */
  clientId?: string;
  clientSecret?: string;
}

export interface XtreamCredentials {
  type: "xtream";
  id: string;
  label: string;
  /**
   * Ordered candidate mirrors for the same account (e.g. http://host:port).
   * Cheap IPTV resellers rotate through many DNS names/servers that go up and
   * down independently — the client tries the last-known-working one first,
   * then races the rest, remembering whichever answers for next time. Always
   * at least one entry.
   */
  baseUrls: string[];
  username: string;
  password: string;
  hiddenCategories: string[];
  /**
   * Persisted across requests/restarts, unlike XtreamClient's own
   * in-memory lastWorkingBaseUrl (which only survives for the life of one
   * client instance) — this is what actually lets "go straight to the
   * mirror that worked last time" survive the snapshot cache refreshing
   * every 10 minutes or the server itself restarting, instead of racing
   * every mirror fresh each time. Written back by iptv-server.ts whenever
   * a different mirror ends up answering.
   */
  lastWorkingBaseUrl?: string;
}

export interface M3uCredentials {
  type: "m3u";
  id: string;
  label: string;
  m3uUrl: string;
  epgUrl?: string;
  hiddenCategories: string[];
}

export type IptvProvider = XtreamCredentials | M3uCredentials;

export interface SportsPrefs {
  enabled: boolean;
  leagues: string[];
  teams: string[];
  spoilerFree: boolean;
  /** gameKey -> channelId, exact override for one specific game (D4/ARCH-R4) */
  channelOverrides: Record<string, string>;
  /**
   * teamKey ("league:normalized team name", see `teamHintKey` in
   * packages/core/src/sports/matcher.ts) -> channelIds confirmed before via
   * a manual override on some past game involving that team. This is the
   * "teaches the mapping" half of D4/ARCH-R4: correcting one game's channel
   * also adds that channel to what gets checked for every *future* game
   * involving either team, so matching gets smarter over time instead of
   * needing a fresh correction every single game — this matters especially
   * for regional sports networks that broadcast schedule data doesn't
   * always name (see docs/08-OPEN-QUESTIONS.md OQ-19).
   */
  teamChannelHints: Record<string, string[]>;
}

export interface UiPrefs {
  railOrder: string[];
  hiddenRails: string[];
  sportsFirst: boolean;
  /**
   * IANA zone name (e.g. "America/New_York"), used to format every game/
   * program clock time — see shared/format-time.ts. Defaults to "UTC"
   * until set; a client-side effect (TimezoneAutoDetect) saves the
   * viewer's real browser zone here automatically the first time nobody's
   * ever set it, without needing a Settings visit first.
   */
  timezone: string;
}

/** REQUIREMENTS F1/B5: how "best source" is chosen when multiple streams are available. */
export interface PlaybackPrefs {
  /** Prefer a debrid-cached source over a higher-resolution uncached one. */
  preferCached: boolean;
  /** "any" leaves aggregateStreams' own resolution ordering (2160p > 1080p > 720p) alone. */
  preferredResolution: "any" | "2160p" | "1080p" | "720p";
  /** "any" shows every source unfiltered. Otherwise a language code (see LANGUAGE_OPTIONS) — hides sources tagged for a different language, see matchesPreferredLanguage. */
  preferredLanguage: string;
}

export interface Config {
  addons: AddonRef[];
  debrid: DebridAuth | null;
  iptv: IptvProvider[];
  sports: SportsPrefs;
  ui: UiPrefs;
  playback: PlaybackPrefs;
}

// ---------------------------------------------------------------------------
// Accounts (D-020) — household-level Config above is shared by every
// account; only watch history (LibraryItem) is per-user. Password hashing
// and session handling are Node/Next-specific and deliberately live in
// apps/web, not here — this is just the portable shape.
// ---------------------------------------------------------------------------

export type UserRole = "admin" | "member";

export interface User {
  id: string;
  username: string;
  /** "salt:hash" hex, scrypt. Never sent to the client past initial creation. */
  passwordHash: string;
  role: UserRole;
  createdAt: number; // epoch ms
}

// ---------------------------------------------------------------------------
// Stremio addon protocol
// ---------------------------------------------------------------------------

export interface StremioManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  resources: Array<
    | "catalog"
    | "meta"
    | "stream"
    | "subtitles"
    | { name: string; types: string[]; idPrefixes?: string[] }
  >;
  types: string[];
  catalogs: StremioCatalogDef[];
  idPrefixes?: string[];
  behaviorHints?: Record<string, unknown>;
}

export interface StremioCatalogDef {
  type: string;
  id: string;
  name?: string;
  extra?: Array<{ name: string; isRequired?: boolean; options?: string[] }>;
}

export interface StremioMetaPreview {
  id: string;
  type: string;
  name: string;
  poster?: string;
  background?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  genres?: string[];
}

export interface StremioVideo {
  id: string;
  title: string;
  season?: number;
  episode?: number;
  released?: string;
  overview?: string;
  thumbnail?: string;
}

export interface StremioMeta extends StremioMetaPreview {
  videos?: StremioVideo[];
  cast?: string[];
  director?: string[];
  runtime?: string;
}

export interface StremioStream {
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  name?: string;
  title?: string;
  description?: string;
  behaviorHints?: {
    bingeGroup?: string;
    notWebReady?: boolean;
    [key: string]: unknown;
  };
  /** Set by our ranking logic, not the addon. */
  sourceAddonId?: string;
}

export interface StremioSubtitle {
  id: string;
  url: string;
  lang: string;
}

// ---------------------------------------------------------------------------
// Debrid
// ---------------------------------------------------------------------------

export interface DebridResolveResult {
  playableUrl: string;
  filename: string;
  filesizeBytes?: number;
}

export interface DebridAccountStatus {
  username: string;
  premiumUntil: number | null; // epoch ms, null = not premium/unknown
  type: "free" | "premium";
}

export interface DebridDeviceAuthStart {
  verificationUrl: string;
  userCode: string;
  deviceCode: string;
  expiresIn: number;
  interval: number;
}

export interface DebridPollOptions {
  intervalMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Common interface every debrid provider client implements (ARCH: debrid module).
 * Providers authenticate one of two ways, never both:
 * - **"device"** (Real-Debrid, AllDebrid): show the user a code + verification
 *   URL, then poll until they confirm — `getAuthUrl`/`pollForToken`.
 * - **"apikey"** (Premiumize, TorBox): the user pastes a long-lived key from
 *   their account page, verified in one request — `connectWithApiKey`.
 */
export interface DebridClient {
  readonly provider: DebridProviderId;
  readonly authMethod: "device" | "apikey";
  getAuthUrl?(): Promise<DebridDeviceAuthStart>;
  pollForToken?(deviceCode: string, options?: DebridPollOptions): Promise<DebridAuth>;
  connectWithApiKey?(apiKey: string): Promise<DebridAuth>;
  getAccountStatus(auth: DebridAuth): Promise<DebridAccountStatus>;
  resolveMagnet(auth: DebridAuth, infoHash: string, fileIdx?: number): Promise<DebridResolveResult>;
  unrestrictLink(auth: DebridAuth, link: string): Promise<DebridResolveResult>;
}

// ---------------------------------------------------------------------------
// IPTV
// ---------------------------------------------------------------------------

export interface Channel {
  providerId: string;
  id: string;
  name: string;
  logo?: string;
  category: string;
  /**
   * Every candidate URL this channel can be played from, most-likely-good
   * first — never just one. An Xtream provider's mirrors don't all serve
   * live streams equally reliably even when they answer the API fine (a
   * real, observed failure mode: one mirror's `get_live_streams` call
   * succeeds but that same mirror's actual stream URLs mostly don't play),
   * so pinning every channel to whichever single mirror happened to answer
   * the channel-list call meant one bad mirror broke every channel at
   * once. Always non-empty; a player retries down this list on failure
   * before giving up (same idea as PlaybackControls' multi-source retry
   * for VOD). M3U providers have no mirror concept, so this is always a
   * single-element array for them.
   */
  streamUrls: string[];
  streamFormat: "hls" | "ts" | "unknown";
  epgChannelId?: string;
}

export interface ChannelCategory {
  id: string;
  name: string;
}

/** Common interface both Xtream and M3U clients implement (ARCH: iptv module). */
export interface IptvClient {
  readonly providerId: string;
  validate(): Promise<boolean>;
  getCategories(): Promise<ChannelCategory[]>;
  getChannels(): Promise<Channel[]>;
}

// ---------------------------------------------------------------------------
// EPG
// ---------------------------------------------------------------------------

export interface EpgProgramme {
  channelId: string; // matches Channel.epgChannelId
  title: string;
  description?: string;
  start: number; // epoch ms
  stop: number; // epoch ms
}

export interface EpgNowNext {
  now: EpgProgramme | null;
  next: EpgProgramme | null;
}

// ---------------------------------------------------------------------------
// Sports
// ---------------------------------------------------------------------------

export type GameStatus = "upcoming" | "live" | "final";

export interface Game {
  id: string; // gameKey, stable per-event
  league: string;
  home: { name: string; abbreviation?: string };
  away: { name: string; abbreviation?: string };
  startTime: number; // epoch ms
  status: GameStatus;
  score?: { home: number; away: number };
  broadcastNetworks: string[];
  matchedChannels: ChannelMatch[];
}

export interface ChannelMatch {
  channelId: string;
  confidence: number; // 0..1
  reason: "network" | "epg-title" | "manual-override" | "team-history";
}

/** Per-league schedule source (ARCH-R5: isolate behind adapters). */
export interface SportsAdapter {
  readonly league: string;
  /** `timezone` decides which calendar day `date` falls on — see EspnAdapter's formatDate for why this can't just use the server's own local time. */
  getSchedule(date: Date, timezone: string): Promise<Game[]>;
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export type LibraryState = "watching" | "watched" | "watchlist";

export interface WatchProgress {
  videoId: string; // series episode id or movie id
  positionSec: number;
  durationSec: number;
  updatedAt: number; // epoch ms
}

/**
 * Real feature request: "if the movie is working for me right now...
 * tomorrow I want to watch the same movie, it should first test the one
 * I was watching successfully." Enough to re-find the SAME underlying
 * torrent/source next time — the actual resolved playback URL (with its
 * debrid token) is single-use/expires, but a magnet's infoHash+fileIdx
 * (or a direct addon url) stays stable across separate `aggregateStreams`
 * calls, since that's a property of the torrent/source itself, not of
 * the query that found it.
 */
export interface LastWorkingSource {
  /** Which episode/movie this was confirmed for — a series' other episodes may have entirely different sources. */
  videoId: string;
  infoHash?: string;
  fileIdx?: number;
  url?: string;
}

export interface LibraryItem {
  metaId: ImdbId;
  type: MediaType;
  state: LibraryState;
  progress?: WatchProgress;
  lastWorkingSource?: LastWorkingSource;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface SyncBundle {
  config: Config;
  library: LibraryItem[];
  version: number;
  updatedAt: number;
}

export interface SyncIdentity {
  syncId: string;
  secretKey: string; // base64, never leaves the client unencrypted
}
