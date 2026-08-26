/** Account status lookup — GET /user. */

import { fetchJson } from "../shared/http.js";
import type { DebridAuth, DebridAccountStatus } from "../shared/types.js";
import { RD_REST_BASE } from "./constants.js";
import type { RdUserResponse } from "./types.js";

export async function getAccountStatus(auth: DebridAuth): Promise<DebridAccountStatus> {
  const data = await fetchJson<RdUserResponse>(`${RD_REST_BASE}/user`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });
  const premiumSeconds = data.premium ?? 0;
  return {
    username: data.username,
    premiumUntil: premiumSeconds > 0 ? Date.now() + premiumSeconds * 1000 : null,
    type: premiumSeconds > 0 ? "premium" : "free",
  };
}
