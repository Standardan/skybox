/**
 * Real-Debrid device-code auth, run in two steps so the (fast) "here's your
 * code" step and the (slow, human-in-the-loop) "waiting for you to confirm
 * in a browser" step don't have to share one blocking call:
 *
 *   pnpm -F @skybox/cli run auth:rd -- start    # prints a URL + code
 *   pnpm -F @skybox/cli run auth:rd -- poll      # waits until you confirm it
 *   pnpm -F @skybox/cli run auth:rd -- status    # checks the saved token
 *
 * The resulting token (including the per-device client secret needed to
 * refresh it later) is saved to .local/rd-auth.json — gitignored, never
 * printed in full.
 */
import { RealDebridClient, isTokenExpired } from "@skybox/core/debrid";
import type { DebridAuth } from "@skybox/core/shared";
import { readLocalJson, writeLocalJson, localPath } from "./local-store.js";

interface SavedDeviceStart {
  verificationUrl: string;
  userCode: string;
  deviceCode: string;
  expiresIn: number;
  interval: number;
  requestedAt: number;
}

const client = new RealDebridClient();

async function start(): Promise<void> {
  const auth = await client.getAuthUrl();
  const saved: SavedDeviceStart = { ...auth, requestedAt: Date.now() };
  writeLocalJson("rd-device.json", saved);

  console.log("\nReal-Debrid device authorization started.\n");
  console.log(`  1. Open:        ${auth.verificationUrl}`);
  console.log(`  2. Enter code:  ${auth.userCode}`);
  console.log(`\nCode is valid for ${Math.round(auth.expiresIn / 60)} minutes.`);
  console.log("Once you've confirmed it in your browser, run:\n");
  console.log("  pnpm -F @skybox/cli run auth:rd -- poll\n");
}

async function poll(): Promise<void> {
  const device = readLocalJson<SavedDeviceStart>("rd-device.json");
  if (!device) {
    console.error("No pending device authorization found. Run 'start' first.");
    process.exitCode = 1;
    return;
  }

  const elapsedSec = (Date.now() - device.requestedAt) / 1000;
  const remainingSec = Math.max(device.expiresIn - elapsedSec, device.interval * 2);
  const maxAttempts = Math.max(Math.floor(remainingSec / device.interval), 1);

  console.log(`Polling every ${device.interval}s (up to ${Math.round(remainingSec / 60)} more minutes) — waiting for you to confirm in your browser...`);

  const auth: DebridAuth = await client.pollForToken(device.deviceCode, {
    intervalMs: device.interval * 1000,
    maxAttempts,
  });
  writeLocalJson("rd-auth.json", auth);

  const status = await client.getAccountStatus(auth);
  console.log(`\nAuthorized as ${status.username} (${status.type}${status.premiumUntil ? `, premium until ${new Date(status.premiumUntil).toISOString()}` : ""}).`);
  console.log(`Saved to ${localPath("rd-auth.json")} (gitignored).`);
}

/**
 * Real-Debrid also supports a "private API token" (from real-debrid.com/apitoken)
 * as a simpler alternative to the device flow — it works as a Bearer token on
 * every endpoint we use, with no OAuth exchange and no meaningful expiry, so we
 * store it as a long-lived DebridAuth with no refresh token.
 */
async function token(rawToken: string): Promise<void> {
  if (!rawToken) {
    console.error("Usage: auth:rd -- token <PRIVATE_API_TOKEN>");
    process.exitCode = 1;
    return;
  }
  const auth: DebridAuth = {
    provider: "real-debrid",
    accessToken: rawToken,
    refreshToken: "",
    expiresAt: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000, // private tokens don't expire in practice
  };
  const account = await client.getAccountStatus(auth);
  writeLocalJson("rd-auth.json", auth);
  console.log(`\nSaved private token as authorized ${account.username} (${account.type}${account.premiumUntil ? `, premium until ${new Date(account.premiumUntil).toISOString()}` : ""}).`);
  console.log(`Saved to ${localPath("rd-auth.json")} (gitignored).`);
}

async function status(): Promise<void> {
  const auth = readLocalJson<DebridAuth>("rd-auth.json");
  if (!auth) {
    console.log("Not authorized yet. Run: pnpm -F @skybox/cli run auth:rd -- start");
    return;
  }
  console.log(`Token expires: ${auth.expiresAt ? new Date(auth.expiresAt).toISOString() : "never"} ${isTokenExpired(auth) ? "(EXPIRED — will refresh on next resolve)" : "(valid)"}`);
  const account = await client.getAccountStatus(auth);
  console.log("Account:", account);
}

const command = process.argv[2] ?? "start";
switch (command) {
  case "start":
    await start();
    break;
  case "poll":
    await poll();
    break;
  case "status":
    await status();
    break;
  case "token":
    await token(process.argv[3] ?? "");
    break;
  default:
    console.error(`Unknown command "${command}". Use: start | poll | status | token <PRIVATE_API_TOKEN>`);
    process.exitCode = 1;
}
