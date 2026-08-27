import { redirect } from "next/navigation";
import { getWatched } from "@skybox/core/library";
import { TopNav } from "@/components/TopNav";
import { WatchHistoryList } from "@/components/WatchHistoryList";
import { getCinemetaAddon } from "@/lib/addon-server";
import { resolveLibraryCards } from "@/lib/library-cards";
import { readLibrary } from "@/lib/library-store";
import { getCurrentUser } from "@/lib/session";
import styles from "@/components/CatalogBrowse.module.css";

// Real per-user library data — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [cinemeta, library] = await Promise.all([getCinemetaAddon(), readLibrary(user.id)]);
  const items = await resolveLibraryCards(cinemeta, getWatched(library));

  return (
    <>
      <TopNav />
      <main>
        <h1 className={styles.heading}>History</h1>
        {items.length === 0 ? (
          <p className={styles.empty}>Nothing watched yet.</p>
        ) : (
          <WatchHistoryList items={items} />
        )}
      </main>
    </>
  );
}
