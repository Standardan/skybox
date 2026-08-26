/** Admin-only user management (D-020): list/create accounts. */
import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { hashPassword } from "@/lib/auth";
import { readUsers, findUserByUsername, createUser } from "@/lib/user-store";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) } as const;
  if (user.role !== "admin") return { error: NextResponse.json({ error: "Admins only." }, { status: 403 }) } as const;
  return { user } as const;
}

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const users = await readUsers();
  return NextResponse.json({
    users: users.map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt })),
  });
}

interface CreateUserBody {
  username?: unknown;
  password?: unknown;
  role?: unknown;
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => null)) as CreateUserBody | null;
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role === "admin" ? "admin" : "member";

  if (username.length < 2) {
    return NextResponse.json({ error: "Username must be at least 2 characters." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (await findUserByUsername(username)) {
    return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({ username, passwordHash, role });

  return NextResponse.json({
    user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt },
  });
}
