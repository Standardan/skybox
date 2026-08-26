/** Current signed-in user, for TopNav's client-side "Signed in as…" affordance. Never returns passwordHash. */
import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({ user: { id: user.id, username: user.username, role: user.role } });
}
