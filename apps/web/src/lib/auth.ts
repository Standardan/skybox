/**
 * Password hashing (D-020). scrypt via `node:crypto` — no dependency, no
 * native bindings, keeps the Docker image simple. Deliberately Node-only
 * (this file must never be imported from middleware, which may run on the
 * Edge runtime — see session.ts for the Edge-safe half of auth).
 */
import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const storedBytes = Buffer.from(hashHex, "hex");
  return derived.length === storedBytes.length && timingSafeEqual(derived, storedBytes);
}
