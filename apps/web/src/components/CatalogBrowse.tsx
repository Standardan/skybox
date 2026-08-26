import type { StremioMetaPreview } from "@skybox/core/shared";
import { getCinemetaAddon, getCachedCatalog } from "@/lib/addon-server";
import { cinemetaPosterUrl } from "@/lib/cinemeta";
import { Rail } from "@/components/Rail";
import { PosterCardLink } from "@/components/PosterCardLink";
import { TopNav } from "@/components/TopNav";
import styles from "./CatalogBrowse.module.css";

// Real catalog id/extras confirmed from Cinemeta's live manifest
// (https://v3-cinemeta.strem.io/manifest.json): both "movie" and "series"
// declare a catalog with id "top" (named "Popular") supporting the
// "genre"/"search"/"skip" extras — not guessed.
const CATALOG_ID = "top";
const GENRE_RAILS = ["Action", "Comedy", "Drama"];

interface CatalogRail {
  title: string;
  items: StremioMetaPreview[];
}

/**
 * Shared browse layout for /movies and /series — a "Popular" rail plus a
 * few genre rails, all sourced from Cinemeta's real "top" catalog (B1).
 */
export async function CatalogBrowse({
  type,
  pageTitle,
}: {
  type: "movie" | "series";
  pageTitle: string;
}) {
  const cinemeta = await getCinemetaAddon();

  const [popular, genreResults] = await Promise.all([
    getCachedCatalog(cinemeta, type, CATALOG_ID),
    Promise.all(GENRE_RAILS.map((genre) => getCachedCatalog(cinemeta, type, CATALOG_ID, { genre }))),
  ]);

  const rails: CatalogRail[] = [
    { title: "Popular", items: popular },
    ...GENRE_RAILS.map((genre, i) => ({ title: genre, items: genreResults[i] ?? [] })),
  ].filter((rail) => rail.items.length > 0);

  return (
    <>
      <TopNav />
      <main>
        <h1 className={styles.heading}>{pageTitle}</h1>
        {rails.length === 0 ? (
          <p className={styles.empty}>Cinemeta returned no titles right now. Try again shortly.</p>
        ) : (
          rails.map((rail) => (
            <Rail key={rail.title} title={rail.title}>
              {rail.items.map((item) => (
                <PosterCardLink
                  key={item.id}
                  href={`/title/${type}/${item.id}`}
                  title={item.name}
                  posterUrl={cinemetaPosterUrl(item.id)}
                />
              ))}
            </Rail>
          ))
        )}
      </main>
    </>
  );
}
