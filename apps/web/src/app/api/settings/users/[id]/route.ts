/** Admin-only user removal (D-020). */
import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { readUsers, deleteUser } from "@/lib/user-store";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (currentUser.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { id } = await params;
  const users = await readUsers();
  const target = users.find((u) => u.id === id);
  if (!target) return NextResponse.json({ error: "That user no longer exists." }, { status: 404 });

  const adminCount = users.filter((u) => u.role === "admin").length;
  if (target.role === "admin" && adminCount <= 1) {
    return NextResponse.json({ error: "Can't remove the last admin." }, { status: 400 });
  }

  await deleteUser(id);
  return NextResponse.json({ ok: true });
}
