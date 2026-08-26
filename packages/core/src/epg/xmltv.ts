/**
 * XMLTV parsing for the epg module.
 *
 * XMLTV documents are a well-known, mostly-flat format: a run of `<channel>`
 * elements followed by a run of `<programme>` elements, each `<programme>`
 * carrying `start`/`stop`/`channel` attributes and a shallow set of children
 * (`<title>`, `<desc>`, `<category>`, ...). We deliberately hand-roll parsing
 * with regex/string scanning instead of pulling in an XML library — see
 * docs/04-INTEGRATIONS.md section 4. Real-world feeds are frequently slightly
 * malformed, so individual bad `<programme>` entries are skipped rather than
 * throwing.
 */

import type { EpgProgramme } from "../shared/types.js";

const PROGRAMME_BLOCK_RE = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
const ATTR_RE = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g;
const TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title>/;
const DESC_RE = /<desc\b[^>]*>([\s\S]*?)<\/desc>/;

/** `YYYYMMDDHHmmss +ZZZZ` / `YYYYMMDDHHmmss -ZZZZ` / `YYYYMMDDHHmmss Z` / bare `YYYYMMDDHHmmss` (assumed UTC). */
const TIMESTAMP_RE =
  /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*(Z|[+-]\d{4}))?$/;

/**
 * Parses one XMLTV timestamp into epoch milliseconds, honoring the timezone
 * offset. Returns null (never throws) if the string doesn't match the
 * expected shape or encodes an impossible date.
 */
export function parseXmltvTimestamp(raw: string): number | null {
  const trimmed = raw.trim();
  const match = TIMESTAMP_RE.exec(trimmed);
  if (!match) return null;

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr, offsetRaw] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  let offsetMs = 0;
  if (offsetRaw && offsetRaw !== "Z") {
    const sign = offsetRaw[0] === "-" ? -1 : 1;
    const offsetHours = Number(offsetRaw.slice(1, 3));
    const offsetMinutes = Number(offsetRaw.slice(3, 5));
    offsetMs = sign * (offsetHours * 60 + offsetMinutes) * 60_000;
  }

  // The timestamp fields describe local (wall-clock) time at `offset` from
  // UTC: localTime = utcTime + offset, so utcTime = localTime - offset.
  const localAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(localAsUtcMs)) return null;

  return localAsUtcMs - offsetMs;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractTagText(re: RegExp, block: string): string | undefined {
  const match = re.exec(block);
  if (!match || match[1] === undefined) return undefined;
  const text = decodeXmlEntities(match[1]).trim();
  return text.length > 0 ? text : undefined;
}

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(attrString)) !== null) {
    const key = m[1] ?? m[3];
    const value = m[2] ?? m[4];
    if (key !== undefined && value !== undefined) {
      attrs[key] = decodeXmlEntities(value);
    }
  }
  return attrs;
}

/**
 * Parses an XMLTV document's `<programme>` elements into flat
 * {@link EpgProgramme} records. Programmes with a missing/unparseable
 * `channel`, `start`, `stop`, or `title` are silently skipped — one bad
 * entry in a feed shouldn't fail the whole parse.
 */
export function parseXmltv(xml: string): EpgProgramme[] {
  const programmes: EpgProgramme[] = [];

  let blockMatch: RegExpExecArray | null;
  PROGRAMME_BLOCK_RE.lastIndex = 0;
  while ((blockMatch = PROGRAMME_BLOCK_RE.exec(xml)) !== null) {
    const attrString = blockMatch[1] ?? "";
    const body = blockMatch[2] ?? "";
    const attrs = parseAttrs(attrString);

    const channelId = attrs.channel;
    if (!channelId) continue;

    const startRaw = attrs.start;
    const stopRaw = attrs.stop;
    if (!startRaw || !stopRaw) continue;

    const start = parseXmltvTimestamp(startRaw);
    const stop = parseXmltvTimestamp(stopRaw);
    if (start === null || stop === null) continue;

    const title = extractTagText(TITLE_RE, body);
    if (!title) continue;

    const description = extractTagText(DESC_RE, body);

    const programme: EpgProgramme = { channelId, title, start, stop };
    if (description !== undefined) programme.description = description;
    programmes.push(programme);
  }

  return programmes;
}
