/**
 * Channel search for the "not this channel?" manual-override picker
 * (D4). Real channel list from `getIptvSnapshot()` — a provider with tens
 * of thousands of channels means this must filter server-side rather than
 * shipping the whole list to the client.
 */
import { NextResponse } from "next/server";
import { getIptvSnapshot } from "@/lib/iptv-server";
import { isRequestHttps, needsStreamProxy, proxiedStreamUrl } from "@/lib/stream-proxy";

// See apps/web/src/app/live/page.tsx for why.
export const fetchCache = "default-no-store";

const MAX_RESULTS = 20;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim().toLowerCase();
  if (!query) return NextResponse.json({ channels: [] });

  const [{ channels }, https] = await Promise.all([getIptvSnapshot(), isRequestHttps()]);
  const matches = channels
    .filter((channel) => channel.name.toLowerCase().includes(query))
    .slice(0, MAX_RESULTS)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      category: channel.category,
      streamUrl: needsStreamProxy(channel.streamUrl, https) ? proxiedStreamUrl(channel.streamUrl) : channel.streamUrl,
      streamFormat: channel.streamFormat,
      logo: channel.logo,
    }));

  return NextResponse.json({ channels: matches });
}
