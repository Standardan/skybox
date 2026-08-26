/**
 * Live TV provider add/edit/remove actions (requirements A4/A5/A9/C6).
 * Xtream and M3U providers are both validated against the real service
 * before being persisted.
 */
import "server-only";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createIptvClient } from "@skybox/core/iptv";
import type { IptvProvider } from "@skybox/core/shared";
import { updateConfig, readConfig } from "@/lib/config-store";
import { invalidateIptvSnapshot } from "@/lib/iptv-server";

function messageFor(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Could not verify that provider.";
}

/**
 * GET ?id=<providerId> — returns the FULL category list for a provider
 * (not just the currently-visible ones). `IptvClient.getCategories()`
 * itself filters out anything already in `hiddenCategories`
 * (packages/core/src/iptv/xtream-client.ts), so building a re-enable-able
 * checklist requires calling it against a clone with `hiddenCategories`
 * cleared — done here rather than in packages/core, which is out of scope
 * to modify.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const config = await readConfig();
  const provider = config.iptv.find((p) => p.id === id);
  if (!provider) {
    return NextResponse.json({ error: "Provider not found." }, { status: 404 });
  }

  try {
    const unfiltered: IptvProvider = { ...provider, hiddenCategories: [] };
    const categories = await createIptvClient(unfiltered).getCategories();
    return NextResponse.json({ categories, hiddenCategories: provider.hiddenCategories });
  } catch (err) {
    return NextResponse.json({ error: messageFor(err) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const type = body.type === "xtream" || body.type === "m3u" ? body.type : null;
  if (!type) {
    return NextResponse.json({ error: "Unknown provider type." }, { status: 400 });
  }

  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : "My IPTV";
  const id = crypto.randomUUID();

  let provider: IptvProvider;
  if (type === "xtream") {
    const baseUrls = Array.isArray(body.baseUrls)
      ? (body.baseUrls as unknown[]).filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      : [];
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (baseUrls.length === 0 || !username || !password) {
      return NextResponse.json({ error: "Server, username, and password are required." }, { status: 400 });
    }
    provider = { type: "xtream", id, label, baseUrls, username, password, hiddenCategories: [] };
  } else {
    const m3uUrl = typeof body.m3uUrl === "string" ? body.m3uUrl.trim() : "";
    const epgUrl = typeof body.epgUrl === "string" && body.epgUrl.trim() ? body.epgUrl.trim() : undefined;
    if (!m3uUrl) {
      return NextResponse.json({ error: "An M3U URL is required." }, { status: 400 });
    }
    provider = { type: "m3u", id, label, m3uUrl, epgUrl, hiddenCategories: [] };
  }

  try {
    const ok = await createIptvClient(provider).validate();
    if (!ok) {
      return NextResponse.json(
        { error: "Could not verify this provider. Check the details and try again." },
        { status: 400 },
      );
    }
  } catch (err) {
    return NextResponse.json({ error: messageFor(err) }, { status: 400 });
  }

  await updateConfig((c) => ({ ...c, iptv: [...c.iptv, provider] }));
  invalidateIptvSnapshot();

  return NextResponse.json({ provider });
}

export async function PATCH(request: Request) {
  let body: { id?: unknown; hiddenCategories?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const hiddenCategories = Array.isArray(body.hiddenCategories)
    ? (body.hiddenCategories as unknown[]).filter((c): c is string => typeof c === "string")
    : null;
  if (!id || hiddenCategories === null) {
    return NextResponse.json({ error: "Missing id or hiddenCategories." }, { status: 400 });
  }

  let found = false;
  const config = await updateConfig((c) => ({
    ...c,
    iptv: c.iptv.map((p) => {
      if (p.id !== id) return p;
      found = true;
      return { ...p, hiddenCategories };
    }),
  }));
  if (!found) {
    return NextResponse.json({ error: "Provider not found." }, { status: 404 });
  }
  invalidateIptvSnapshot();

  return NextResponse.json({ provider: config.iptv.find((p) => p.id === id) });
}

export async function DELETE(request: Request) {
  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const config = await updateConfig((c) => ({ ...c, iptv: c.iptv.filter((p) => p.id !== id) }));
  invalidateIptvSnapshot();

  return NextResponse.json({ iptv: config.iptv });
}
