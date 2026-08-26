/**
 * Network alias dictionary + channel-name normalization for the sports
 * matching engine (ARCH-R4 / 04-INTEGRATIONS §6 step 1).
 *
 * Keys are the canonical network names as ESPN reports them in
 * `competitions[].broadcasts[].names[]` — this includes national networks
 * AND regional sports networks (RSNs) for local-market games (Bally/FanDuel
 * Sports, NBC Sports regionals, YES, SNY, MSG, etc.), not just the handful
 * of national broadcasters. Values are lowercase substrings you'd
 * realistically see in real-world IPTV channel names, which vary a lot
 * between providers (spacing, abbreviations, "Sports" vs "Spts", regional
 * suffixes). This is explicitly meant to grow over time — keep it as plain
 * data, not logic. `matchByNetwork` (matcher.ts) also falls back to the raw
 * ESPN network name itself when it isn't listed here, so an unlisted RSN
 * still matches a channel with the identical (or near-identical) name.
 */
export const NETWORK_ALIASES: Record<string, string[]> = {
  // --- National broadcast/cable ---
  ESPN: ["espn", "espn usa", "espn us"],
  ESPN2: ["espn2", "espn 2"],
  "ESPN3": ["espn3", "espn 3"],
  ESPNU: ["espnu", "espn u"],
  "ESPN News": ["espnews", "espn news"],
  "ESPN Deportes": ["espn deportes"],
  ABC: ["abc"],
  FOX: ["fox", "fox us", "fox usa", "fox network"],
  "FS1": ["fs1", "fox sports 1", "fs 1"],
  "FS2": ["fs2", "fox sports 2", "fs 2"],
  "Fox Deportes": ["fox deportes"],
  TNT: ["tnt"],
  "TNT Sports": ["tnt sports", "tnt sports 1", "tnt sports 2", "tnt sports 3", "tnt sports 4", "bt sport"],
  NBC: ["nbc"],
  Peacock: ["peacock", "peacock tv"],
  CBS: ["cbs"],
  "CBS Sports Network": ["cbs sports network", "cbs sports net", "cbssn"],
  "NBA TV": ["nba tv", "nbatv"],
  "NFL Network": ["nfl network", "nfl net", "nflnetwork"],
  "NFL RedZone": ["nfl redzone", "redzone", "nfl rz"],
  "USA Network": ["usa network", "usanetwork"],
  TBS: ["tbs"],
  truTV: ["trutv", "tru tv"],
  "MLB Network": ["mlb network", "mlb net", "mlbnetwork"],
  "NHL Network": ["nhl network", "nhl net", "nhlnetwork"],
  "Golf Channel": ["golf channel", "golf channel usa", "golfchannel"],
  "Tennis Channel": ["tennis channel"],
  "MLS Season Pass": ["mls season pass", "mls"],
  "ACC Network": ["acc network", "acc net", "accn"],
  "SEC Network": ["sec network", "sec net", "secn"],
  "Big Ten Network": ["big ten network", "btn", "big ten net"],
  "Pac-12 Network": ["pac-12 network", "pac 12 network", "pac12"],
  Univision: ["univision"],
  Telemundo: ["telemundo"],
  TUDN: ["tudn"],
  DAZN: ["dazn"],

  // --- Regional sports networks (RSNs) — huge source of real-world misses ---
  "Bally Sports": ["bally sports", "ballysports", "bally spts", "bally sport"],
  "FanDuel Sports Network": ["fanduel sports", "fanduel sports network", "fdsn"],
  "NBC Sports Boston": ["nbc sports boston", "nbcs boston", "nbc sports bos"],
  "NBC Sports Bay Area": ["nbc sports bay area", "nbcs bay area", "nbc sports ba"],
  "NBC Sports California": ["nbc sports california", "nbcs california", "nbc sports cal"],
  "NBC Sports Chicago": ["nbc sports chicago", "nbcs chicago"],
  "NBC Sports Philadelphia": ["nbc sports philadelphia", "nbcs philadelphia", "nbc sports philly"],
  "NBC Sports Washington": ["nbc sports washington", "nbcs washington", "nbc sports dc"],
  "YES Network": ["yes network", "yesnetwork", "yes"],
  SNY: ["sny"],
  MSG: ["msg", "msg network", "msg plus"],
  NESN: ["nesn"],
  "Marquee Sports Network": ["marquee sports network", "marquee sports", "marquee network"],
  "Root Sports": ["root sports", "rootsports"],
  "Altitude Sports": ["altitude sports", "altitude"],
  "Spectrum SportsNet": ["spectrum sportsnet", "spectrum sn", "sportsnet la"],
  "AT&T SportsNet": ["att sportsnet", "attsn"],
  "Monumental Sports Network": ["monumental sports network", "monumental sports"],
  MASN: ["masn", "mid-atlantic sports"],
  "Chicago Sports Network": ["chicago sports network", "chsn"],
  "Rangers Sports Network": ["rangers sports network", "rangers sports net"],
  "Space City Home Network": ["space city home network", "space city home"],
  "SportsNet LA": ["sportsnet la", "spectrum sportsnet la"],
  "Detroit SportsNet": ["detroit sportsnet"],
  BravesVision: ["bravesvision", "braves vision"],

  // --- International / soccer ---
  "Sky Sports": ["sky sports"],
  "beIN Sports": ["bein sports", "bein sport", "beinsports"],
  Sportsnet: ["sportsnet"],
  TSN: ["tsn"],
  "Willow TV": ["willow tv", "willow"],
};

/** Noise tokens stripped as whole words when normalizing a channel name (quality/resolution tags). */
const NOISE_TOKENS = ["hd", "fhd", "uhd", "sd", "4k", "8k", "hevc", "1080p", "720p", "540p", "480p", "360p", "2160p"];

const NOISE_PATTERN = new RegExp(`\\b(?:${NOISE_TOKENS.join("|")})\\b`, "gi");

/** Country-code / region prefixes like "US:", "USA:", "UK|", "us |". Checked before punctuation is stripped, since it relies on the literal separator. */
const PREFIX_PATTERN = /^[a-z]{2,3}\s*[|:]\s*/i;

/**
 * Any character that isn't a Unicode letter, digit, or whitespace — dashes,
 * dots, slashes, underscores, parens/brackets, bullets, flag emoji, etc.
 * Real IPTV channel names use all of these as separators inconsistently
 * ("ESPN-USA", "Bally Sports (Detroit)", "🇺🇸 ESPN", "ESPN.2").
 */
const PUNCTUATION_PATTERN = /[^\p{L}\p{N}\s]/gu;

/**
 * Lowercase, strip common IPTV noise (country-code prefixes, punctuation of
 * every kind, quality/resolution tags), and collapse whitespace. Exported
 * directly so it can be unit tested on its own, independent of the matching
 * functions that use it.
 */
export function normalizeChannelName(name: string): string {
  let normalized = name.toLowerCase();
  normalized = normalized.replace(PREFIX_PATTERN, "");
  normalized = normalized.replace(PUNCTUATION_PATTERN, " ");
  normalized = normalized.replace(NOISE_PATTERN, " ");
  normalized = normalized.replace(/\s+/g, " ").trim();
  return normalized;
}
