"use server";

import type { PlaybackPrefs } from "@skybox/core/shared";
import { updateConfig } from "@/lib/config-store";

export async function setPreferCached(preferCached: boolean): Promise<PlaybackPrefs> {
  const config = await updateConfig((c) => ({ ...c, playback: { ...c.playback, preferCached } }));
  return config.playback;
}

export async function setPreferredResolution(
  preferredResolution: PlaybackPrefs["preferredResolution"],
): Promise<PlaybackPrefs> {
  const config = await updateConfig((c) => ({ ...c, playback: { ...c.playback, preferredResolution } }));
  return config.playback;
}

export async function setPreferredLanguage(preferredLanguage: string): Promise<PlaybackPrefs> {
  const config = await updateConfig((c) => ({ ...c, playback: { ...c.playback, preferredLanguage } }));
  return config.playback;
}
