/**
 * Server-only persistence for accounts (D-020): `User[]` in `users.json`,
 * same atomic-write-queue/`readJsonIfExists` pattern as config-store.ts.
 * Also owns the HMAC secret session.ts signs cookies with — generated once
 * on first use and persisted alongside the users it authenticates, so
 * restarting the server (or a fresh Docker container reusing the same data
 * volume) doesn't invalidate every existing session.
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { User } from "@skybox/core/shared";
import { getDataDir } from "./data-dir";

const LOCAL_DIR = getDataDir();
const USERS_PATH = path.join(LOCAL_DIR, "users.json");
const AUTH_SECRET_PATH = path.join(LOCAL_DIR, "auth-secret.json");

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmpPath, filePath);
}

let writeQueue: Promise<unknown> = Promise.resolve();

export async function readUsers(): Promise<User[]> {
  return (await readJsonIfExists<User[]>(USERS_PATH)) ?? [];
}

export function writeUsers(users: User[]): Promise<void> {
  writeQueue = writeQueue.then(() => writeJsonAtomic(USERS_PATH, users));
  return writeQueue as Promise<void>;
}

export async function findUserByUsername(username: string): Promise<User | null> {
  const users = await readUsers();
  const needle = username.trim().toLowerCase();
  return users.find((u) => u.username.toLowerCase() === needle) ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  const users = await readUsers();
  return users.find((u) => u.id === id) ?? null;
}

export async function createUser(input: { username: string; passwordHash: string; role: User["role"] }): Promise<User> {
  const users = await readUsers();
  const user: User = { id: randomUUID(), createdAt: Date.now(), ...input };
  await writeUsers([...users, user]);
  return user;
}

export async function deleteUser(id: string): Promise<void> {
  const users = await readUsers();
  await writeUsers(users.filter((u) => u.id !== id));
}

/** Lazily generated on first use (same "seed on first use" pattern as config-store.ts's legacy migration) and persisted — never rotated automatically, since that would silently log out every session. */
let secretCache: string | null = null;

export async function getAuthSecret(): Promise<string> {
  if (secretCache) return secretCache;
  const existing = await readJsonIfExists<{ secret: string }>(AUTH_SECRET_PATH);
  if (existing) {
    secretCache = existing.secret;
    return secretCache;
  }
  const secret = randomBytes(32).toString("base64url");
  await writeJsonAtomic(AUTH_SECRET_PATH, { secret });
  secretCache = secret;
  return secret;
}
