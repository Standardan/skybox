/**
 * Admin-only: trigger an update (D-023). Forwards to the isolated
 * `updater` sidecar (see updater/server.js and docker-compose.yml) rather
 * than doing anything privileged here — this app itself never touches
 * Docker or git. If that service isn't running (the `updates` profile
 * wasn't enabled), this fails clearly rather than pretending to work.
 */
import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";

const UPDATER_URL = process.env.SKYBOX_UPDATER_URL ?? "http://updater:9999";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${UPDATER_URL}/apply-update`, { method: "POST", signal: controller.signal });
    clearTimeout(timer);

    if (res.status === 409) {
      return NextResponse.json({ error: "An update is already in progress." }, { status: 409 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `Updater responded with ${res.status}.` }, { status: 502 });
    }
    return NextResponse.json({ status: "started" });
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not reach the updater service. It only runs when started with `docker compose --profile updates up -d` — see README.md's \"Updating Skybox\" for the manual alternative.",
      },
      { status: 503 },
    );
  }
}
