/** Provider-agnostic constructor: pick a DebridClient implementation by id. */
import type { DebridClient, DebridProviderId } from "../shared/types.js";
import { RealDebridClient } from "./client.js";
import { AllDebridClient } from "./alldebrid.js";
import { PremiumizeClient } from "./premiumize.js";
import { TorboxClient } from "./torbox.js";

export const DEBRID_PROVIDERS: Array<{ id: DebridProviderId; label: string; authMethod: "device" | "apikey" }> = [
  { id: "real-debrid", label: "Real-Debrid", authMethod: "device" },
  { id: "alldebrid", label: "AllDebrid", authMethod: "device" },
  { id: "premiumize", label: "Premiumize", authMethod: "apikey" },
  { id: "torbox", label: "TorBox", authMethod: "apikey" },
];

export function createDebridClient(provider: DebridProviderId): DebridClient {
  switch (provider) {
    case "real-debrid":
      return new RealDebridClient();
    case "alldebrid":
      return new AllDebridClient();
    case "premiumize":
      return new PremiumizeClient();
    case "torbox":
      return new TorboxClient();
  }
}
