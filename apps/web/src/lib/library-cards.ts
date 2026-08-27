import type { AddonRef, LibraryItem } from "@skybox/core/shared";
import { getCachedMeta } from "@/lib/addon-server";
import { cinemetaPosterUrl } from "@/lib/cinemeta";

export interface LibraryCard {
  id: string;
  title: string;
  posterUrl: string;
  href: string;
  /** 0-1 fraction, only present for items with real watch progress (Continue Watching). */
  progress?: number;
}

/**
 * `LibraryItem` only stores ids/state (packages/core/library is
 * metadata-agnostic on purpose), so each item needs a real Cinemeta lookup
 * for its name/poster. Shared by the Continue Watching rail, the My List
 * rail + page, and the History page — extracted once instead of copy-
 * pasted per caller. Movie/series only — a "channel" type item would mean
 * live TV, which has no meaningful title-card concept here.
 */
export async function resolveLibraryCards(cinemeta: AddonRef, items: LibraryItem[]): Promise<LibraryCard[]> {
  const relevant = items.filter((item) => item.type === "movie" || item.type === "series");

  const cards = await Promise.all(
    relevant.map(async (item): Promise<LibraryCard | null> => {
      try {
        const meta = await getCachedMeta(cinemeta, item.type, item.metaId);
        const resumeVideo =
          item.progress && item.progress.videoId !== item.metaId ? `?video=${item.progress.videoId}` : "";
        return {
          id: item.metaId,
          title: meta.name,
          posterUrl: cinemetaPosterUrl(item.metaId),
          href: `/title/${item.type}/${item.metaId}${resumeVideo}`,
          progress: item.progress
            ? Math.min(1, Math.max(0, item.progress.positionSec / item.progress.durationSec))
            : undefined,
        };
      } catch {
        // A title that's since disappeared from Cinemeta shouldn't break the list.
        return null;
      }
    }),
  );

  return cards.filter((card): card is LibraryCard => card !== null);
}
