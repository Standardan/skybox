/** Creates the first (admin) account (D-020). Only works while zero accounts exist — re-checked here, not just in the /setup page, since this is the actual write path. */
import "server-only";
import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { readUsers, createUser } from "@/lib/user-store";
import { setSessionCookie } from "@/lib/session";

interface SetupBody {
  username?: unknown;
  password?: unknown;
}

export async function POST(request: Request) {
  const existing = await readUsers();
  if (existing.length > 0) {
    return NextResponse.json({ error: "Setup has already been completed." }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as SetupBody | null;
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (username.length < 2) {
    return NextResponse.json({ error: "Username must be at least 2 characters." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({ username, passwordHash, role: "admin" });
  await setSessionCookie(user);

  return NextResponse.json({ ok: true });
}
