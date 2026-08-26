/** Real-team search for the searchable team picker (D-024). See sports-server.ts's searchTeams. */
import "server-only";
import { NextResponse } from "next/server";
import { searchTeams } from "@/lib/sports-server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const teams = await searchTeams(query);
  return NextResponse.json({ teams });
}
