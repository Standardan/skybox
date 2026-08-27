import { redirect } from "next/navigation";
import { getWatchlist } from "@skybox/core/library";
import { TopNav } from "@/components/TopNav";
import { WatchlistGrid } from "@/components/WatchlistGrid";
import { getCinemetaAddon } from "@/lib/addon-server";
import { resolveLibraryCards } from "@/lib/library-cards";
import { readLibrary } from "@/lib/library-store";
import { getCurrentUser } from "@/lib/session";
import styles from "@/components/CatalogBrowse.module.css";

// Real per-user library data — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [cinemeta, library] = await Promise.all([getCinemetaAddon(), readLibrary(user.id)]);
  const items = await resolveLibraryCards(cinemeta, getWatchlist(library));

  return (
    <>
      <TopNav />
      <main>
        <h1 className={styles.heading}>My List</h1>
        {items.length === 0 ? (
          <p className={styles.empty}>Nothing on your list yet — add a title from its page.</p>
        ) : (
          <WatchlistGrid items={items} />
        )}
      </main>
    </>
  );
}
