/** Config export as a file — requirement G4. */
import "server-only";
import { readConfig } from "@/lib/config-store";

export async function GET() {
  const config = await readConfig();
  const body = JSON.stringify(config, null, 2);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="skybox-config.json"',
    },
  });
}
