/**
 * Debrid connection flow (requirement A3/A7), generic across providers.
 *
 * Two auth shapes, dispatched by the chosen provider's `authMethod`:
 * - **"device"** (Real-Debrid, AllDebrid): `action: "start"` gets a
 *   code + verification URL; `action: "poll"` blocks for as long as the
 *   user takes to confirm (bounded by the code's real `expiresIn`), then
 *   resolves with the final connected/error outcome — there's no
 *   intermediate "still pending" state reported back per request.
 * - **"apikey"** (Premiumize, TorBox): `action: "connect-apikey"` verifies
 *   a pasted key against the provider in one request.
 */
import "server-only";
import { NextResponse } from "next/server";
import { createDebridClient } from "@/lib/debrid-server";
import { updateConfig } from "@/lib/config-store";
import type { DebridProviderId } from "@skybox/core/shared";
import { DEBRID_PROVIDERS } from "@skybox/core/debrid";

function isDebridProvider(value: unknown): value is DebridProviderId {
  return typeof value === "string" && DEBRID_PROVIDERS.some((p) => p.id === value);
}

export async function POST(request: Request) {
  let body: { action?: unknown; provider?: unknown; deviceCode?: unknown; expiresIn?: unknown; interval?: unknown; apiKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const provider = isDebridProvider(body.provider) ? body.provider : null;
  if (!provider) {
    return NextResponse.json({ error: "Missing or unknown provider." }, { status: 400 });
  }
  const client = createDebridClient(provider);

  if (body.action === "start") {
    if (!client.getAuthUrl) {
      return NextResponse.json({ error: `${provider} doesn't use a device code — connect with an API key instead.` }, { status: 400 });
    }
    try {
      const info = await client.getAuthUrl();
      return NextResponse.json(info);
    } catch {
      return NextResponse.json(
        { error: "Could not start the connection. Try again in a moment." },
        { status: 502 },
      );
    }
  }

  if (body.action === "poll") {
    if (!client.pollForToken) {
      return NextResponse.json({ error: `${provider} doesn't use a device code.` }, { status: 400 });
    }
    const deviceCode = typeof body.deviceCode === "string" ? body.deviceCode : "";
    if (!deviceCode) {
      return NextResponse.json({ error: "Missing deviceCode." }, { status: 400 });
    }
    const expiresIn = typeof body.expiresIn === "number" ? body.expiresIn : 1800;
    const interval = typeof body.interval === "number" && body.interval > 0 ? body.interval : 5;

    try {
      const auth = await client.pollForToken(deviceCode, {
        intervalMs: interval * 1000,
        maxAttempts: Math.max(1, Math.ceil(expiresIn / interval)),
      });
      await updateConfig((c) => ({ ...c, debrid: auth }));
      const account = await client.getAccountStatus(auth);
      return NextResponse.json({ status: "connected", account });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      return NextResponse.json({
        status: "error",
        message: `That code expired or wasn't confirmed in time (${message}). Start over to get a new code.`,
      });
    }
  }

  if (body.action === "connect-apikey") {
    if (!client.connectWithApiKey) {
      return NextResponse.json({ error: `${provider} doesn't use an API key.` }, { status: 400 });
    }
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) {
      return NextResponse.json({ error: "Enter an API key." }, { status: 400 });
    }
    try {
      const auth = await client.connectWithApiKey(apiKey);
      await updateConfig((c) => ({ ...c, debrid: auth }));
      const account = await client.getAccountStatus(auth);
      return NextResponse.json({ status: "connected", account });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      return NextResponse.json({ status: "error", message: `Could not verify that key: ${message}` });
    }
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export async function DELETE() {
  await updateConfig((c) => ({ ...c, debrid: null }));
  return NextResponse.json({ ok: true });
}
