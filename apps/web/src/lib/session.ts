/**
 * Signed session cookies (D-020). Stateless: the cookie itself carries
 * `{userId, role, exp}` plus an HMAC-SHA256 signature, so verifying a
 * session needs no server-side session table — just the persisted secret
 * (user-store.ts's `getAuthSecret`). Runs in the Node.js runtime (both
 * middleware.ts and every Route Handler/Server Component that calls this
 * opt into `runtime = "nodejs"` where relevant) so it can use `node:crypto`
 * directly rather than juggling a Web Crypto/Node split.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { User, UserRole } from "@skybox/core/shared";
import { getAuthSecret, findUserById } from "./user-store";

export const SESSION_COOKIE = "skybox_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionPayload {
  userId: string;
  role: UserRole;
  exp: number; // epoch ms
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

async function sign(payload: string): Promise<string> {
  const secret = await getAuthSecret();
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export async function encodeSession(payload: SessionPayload): Promise<string> {
  const body = base64url(JSON.stringify(payload));
  const signature = await sign(body);
  return `${body}.${signature}`;
}

export async function decodeSession(cookieValue: string | undefined): Promise<SessionPayload | null> {
  if (!cookieValue) return null;
  const [body, signature] = cookieValue.split(".");
  if (!body || !signature) return null;

  const expectedSignature = await sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.userId !== "string" || typeof payload.role !== "string" || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * True when the current request reached this app over HTTPS — via
 * `x-forwarded-proto` (set correctly by a reverse proxy/Caddy in front of a
 * VPS deployment) or the request's own protocol for a direct TLS listener.
 * Same signal used by stream-proxy.ts to decide whether an HTTP-only IPTV
 * stream needs proxying to avoid a mixed-content block.
 */
export async function isRequestHttps(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0]!.trim() === "https";
  return h.get("x-forwarded-ssl") === "on";
}

/** Sets the session cookie for `user`. Marks the cookie `secure` only over HTTPS — an unconditional `secure: true` would silently drop the cookie on a plain-http:// local/VPS deployment. */
export async function setSessionCookie(user: User): Promise<void> {
  const payload: SessionPayload = { userId: user.id, role: user.role, exp: Date.now() + SESSION_TTL_MS };
  const value = await encodeSession(payload);
  const secure = await isRequestHttps();
  const store = await cookies();
  store.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** For Server Components/Route Handlers past the middleware gate — returns the full current `User`, not just the session payload. */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const payload = await decodeSession(store.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  return findUserById(payload.userId);
}
