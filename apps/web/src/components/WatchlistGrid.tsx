"use client";

import { useState } from "react";
import { Rail } from "@/components/Rail";
import { PosterCardLink } from "@/components/PosterCardLink";
import type { LibraryCard } from "@/lib/library-cards";

/** My List (B9) full page — same optimistic-removal pattern as ContinueWatchingRail. */
export function WatchlistGrid({ items }: { items: LibraryCard[] }) {
  const [visible, setVisible] = useState(items);

  function handleDismiss(id: string) {
    setVisible((prev) => prev.filter((item) => item.id !== id));
    void fetch("/api/library/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", metaId: id }),
    }).catch(() => {});
  }

  if (visible.length === 0) {
    return <p>Nothing on your list yet — add a title from its page.</p>;
  }

  return (
    <Rail title="My List">
      {visible.map((item) => (
        <PosterCardLink
          key={item.id}
          href={item.href}
          title={item.title}
          posterUrl={item.posterUrl}
          onDismiss={() => handleDismiss(item.id)}
          dismissLabel={`Remove ${item.title} from My List`}
        />
      ))}
    </Rail>
  );
}
