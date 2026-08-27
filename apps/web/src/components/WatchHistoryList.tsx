"use client";

import { useState } from "react";
import { Rail } from "@/components/Rail";
import { PosterCardLink } from "@/components/PosterCardLink";
import type { LibraryCard } from "@/lib/library-cards";

/** Watch history full page — same optimistic-removal pattern as ContinueWatchingRail. */
export function WatchHistoryList({ items }: { items: LibraryCard[] }) {
  const [visible, setVisible] = useState(items);

  function handleDismiss(id: string) {
    setVisible((prev) => prev.filter((item) => item.id !== id));
    void fetch("/api/library/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metaId: id }),
    }).catch(() => {});
  }

  if (visible.length === 0) {
    return <p>Nothing watched yet.</p>;
  }

  return (
    <Rail title="Watched">
      {visible.map((item) => (
        <PosterCardLink
          key={item.id}
          href={item.href}
          title={item.title}
          posterUrl={item.posterUrl}
          onDismiss={() => handleDismiss(item.id)}
          dismissLabel={`Remove ${item.title} from history`}
        />
      ))}
    </Rail>
  );
}
