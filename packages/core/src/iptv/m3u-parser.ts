/**
 * Standalone M3U playlist parser (docs/04-INTEGRATIONS.md §4).
 *
 * Parses `#EXTINF` lines (with optionally-quoted, order-independent
 * attributes) followed by a stream URL line. XMLTV/EPG parsing is out of
 * scope for this module — see the sibling `epg` module.
 */

export interface RawM3uEntry {
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
  groupTitle?: string;
  /** The text trailing the last EXTINF comma (the human-readable title). */
  displayName: string;
  streamUrl: string;
}

const ATTR_REGEX = /([\w-]+)=(?:"([^"]*)"|(\S+))/g;

/** Finds the first comma not enclosed in double quotes. Returns -1 if none. */
function findTopLevelComma(text: string): number {
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      return i;
    }
  }
  return -1;
}

function parseExtinfLine(line: string): { attrs: Record<string, string>; displayName: string } {
  const colonIdx = line.indexOf(":");
  const afterColon = colonIdx === -1 ? "" : line.slice(colonIdx + 1);
  const splitIdx = findTopLevelComma(afterColon);
  const attrPart = splitIdx === -1 ? afterColon : afterColon.slice(0, splitIdx);
  const displayName = splitIdx === -1 ? "" : afterColon.slice(splitIdx + 1).trim();

  const attrs: Record<string, string> = {};
  ATTR_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_REGEX.exec(attrPart)) !== null) {
    const key = match[1]!.toLowerCase();
    const value = match[2] !== undefined ? match[2] : (match[3] ?? "");
    attrs[key] = value;
  }
  return { attrs, displayName };
}

export function parseM3u(text: string): RawM3uEntry[] {
  const lines = text.split(/\r\n|\r|\n/);
  const entries: RawM3uEntry[] = [];
  let pending: { attrs: Record<string, string>; displayName: string } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    if (line.startsWith("#EXTINF")) {
      pending = parseExtinfLine(line);
      continue;
    }

    if (line.startsWith("#")) {
      // Other directives (#EXTM3U, #EXTGRP, #EXTVLCOPT, ...) are not relevant here.
      continue;
    }

    // Non-comment, non-empty line: the stream URL for the pending EXTINF entry.
    if (pending) {
      const attrs = pending.attrs;
      entries.push({
        tvgId: attrs["tvg-id"] || undefined,
        tvgName: attrs["tvg-name"] || undefined,
        tvgLogo: attrs["tvg-logo"] || undefined,
        groupTitle: attrs["group-title"] || undefined,
        displayName: pending.displayName,
        streamUrl: line,
      });
      pending = null;
    }
    // A URL with no preceding #EXTINF is not a valid entry; skip it.
  }

  return entries;
}
