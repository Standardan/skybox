/** Admin-only: current update-check status (D-023). */
import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { checkForUpdate } from "@/lib/update-check";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const status = await checkForUpdate();
  return NextResponse.json(status);
}
