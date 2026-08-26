import { NextResponse, type NextRequest } from "next/server";
import { catalogSearch } from "@skybox/core/addon-client";
import type { StremioMetaPreview } from "@skybox/core/shared";
import { getCinemetaAddon } from "@/lib/addon-server";

// Same real Cinemeta "top" catalog id used for browse (B1) — its manifest
// declares "search" as a supported extra for both movie and series (B2).
const CATALOG_ID = "top";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ results: [] satisfies StremioMetaPreview[] });
  }

  const cinemeta = await getCinemetaAddon();
  const [movies, series] = await Promise.all([
    catalogSearch(cinemeta, "movie", CATALOG_ID, query),
    catalogSearch(cinemeta, "series", CATALOG_ID, query),
  ]);

  return NextResponse.json({ results: [...movies, ...series] satisfies StremioMetaPreview[] });
}
