/**
 * Addon add/reorder/remove actions (requirement A2). Validation happens
 * here via `fetchManifest` before anything is persisted — a broken manifest
 * URL never makes it into config.
 */
import "server-only";
import { NextResponse } from "next/server";
import { fetchManifest } from "@skybox/core/addon-client";
import { updateConfig } from "@/lib/config-store";

function messageFor(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Could not reach that addon.";
}

export async function POST(request: Request) {
  let body: { transportUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const transportUrl = typeof body.transportUrl === "string" ? body.transportUrl.trim() : "";
  if (!transportUrl) {
    return NextResponse.json({ error: "Enter a manifest URL." }, { status: 400 });
  }

  let manifest;
  try {
    manifest = await fetchManifest(transportUrl);
  } catch (err) {
    return NextResponse.json(
      { error: `That addon couldn't be reached or its manifest is invalid: ${messageFor(err)}` },
      { status: 400 },
    );
  }

  const config = await updateConfig((c) => {
    if (c.addons.some((a) => a.transportUrl === transportUrl)) return c;
    return {
      ...c,
      addons: [...c.addons, { transportUrl, manifest, enabled: true, order: c.addons.length }],
    };
  });

  const addon = config.addons.find((a) => a.transportUrl === transportUrl);
  return NextResponse.json({ addon });
}

export async function PATCH(request: Request) {
  let body: { transportUrl?: unknown; direction?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const transportUrl = typeof body.transportUrl === "string" ? body.transportUrl : "";
  const direction = body.direction === "up" || body.direction === "down" ? body.direction : null;
  if (!transportUrl || !direction) {
    return NextResponse.json({ error: "Missing transportUrl or direction." }, { status: 400 });
  }

  const config = await updateConfig((c) => {
    const sorted = [...c.addons].sort((a, b) => a.order - b.order);
    const index = sorted.findIndex((a) => a.transportUrl === transportUrl);
    if (index === -1) return c;
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= sorted.length) return c;

    const a = sorted[index]!;
    const b = sorted[swapWith]!;
    const aOrder = a.order;
    a.order = b.order;
    b.order = aOrder;

    return { ...c, addons: sorted };
  });

  return NextResponse.json({ addons: config.addons });
}

export async function DELETE(request: Request) {
  let body: { transportUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const transportUrl = typeof body.transportUrl === "string" ? body.transportUrl : "";
  if (!transportUrl) {
    return NextResponse.json({ error: "Missing transportUrl." }, { status: 400 });
  }

  const config = await updateConfig((c) => {
    const remaining = c.addons
      .filter((a) => a.transportUrl !== transportUrl)
      .sort((a, b) => a.order - b.order)
      .map((a, i) => ({ ...a, order: i }));
    return { ...c, addons: remaining };
  });

  return NextResponse.json({ addons: config.addons });
}
