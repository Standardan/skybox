/** Config import from an uploaded file — requirement G4. */
import "server-only";
import { NextResponse } from "next/server";
import type { Config } from "@skybox/core/shared";
import { writeConfig } from "@/lib/config-store";
import { invalidateIptvSnapshot } from "@/lib/iptv-server";

/** Basic top-level shape check — not a full schema validation, just enough to
 * catch "this isn't a Skybox config file" before it overwrites the real one. */
function isPlausibleConfig(value: unknown): value is Config {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.addons) &&
    (v.debrid === null || typeof v.debrid === "object") &&
    Array.isArray(v.iptv) &&
    typeof v.sports === "object" &&
    v.sports !== null &&
    typeof v.ui === "object" &&
    v.ui !== null
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That file isn't valid JSON." }, { status: 400 });
  }

  if (!isPlausibleConfig(body)) {
    return NextResponse.json(
      { error: "That file doesn't look like a Skybox config export (missing addons/debrid/iptv/sports/ui)." },
      { status: 400 },
    );
  }

  await writeConfig(body);
  invalidateIptvSnapshot();

  return NextResponse.json({ ok: true });
}
