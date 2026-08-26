/** Verifies username/password and sets the session cookie (D-020). */
import "server-only";
import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth";
import { findUserByUsername } from "@/lib/user-store";
import { setSessionCookie } from "@/lib/session";

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as LoginBody | null;
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!username || !password) {
    return NextResponse.json({ error: "Enter a username and password." }, { status: 400 });
  }

  const user = await findUserByUsername(username);
  // Same "invalid username or password" message either way — never reveal
  // which half was wrong, that's a username-enumeration oracle.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  await setSessionCookie(user);
  return NextResponse.json({ ok: true });
}
