/**
 * Auth gate (D-020). Runs on every request except the pages/routes that
 * must stay reachable while logged out (`/login`, `/setup`, `/api/auth/*`)
 * and static assets. Node.js runtime (not the default Edge runtime) so
 * session.ts can use `node:crypto` directly instead of a separate Web
 * Crypto code path just for this one file.
 *
 * Deliberately does NOT check "does any user exist yet" itself — that's
 * `/login`'s job (see app/login/page.tsx), which can freely read
 * `users.json` as a normal Server Component. Keeping that check out of
 * middleware avoids a second fs-dependent code path here.
 */
import { NextResponse, type NextRequest } from "next/server";
import { decodeSession, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

export async function middleware(request: NextRequest) {
  const session = await decodeSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (request.nextUrl.pathname !== "/") {
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Match everything except:
     * - /login, /setup, /api/auth/* (must work while logged out)
     * - Next.js internals and common static asset extensions
     */
    "/((?!login|setup|api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
