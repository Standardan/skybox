"use client";

import { useState } from "react";
import { Rail } from "@/components/Rail";
import { PosterCardLink } from "@/components/PosterCardLink";
import type { LibraryCard } from "@/lib/library-cards";

/**
 * Real feature request: a dismiss button on each Continue Watching card.
 * Client component (unlike the rest of the server-rendered home page)
 * specifically so a dismiss can remove the item from the rail immediately
 * — optimistic, before the background POST even resolves — rather than
 * needing a full page reload to reflect the change.
 */
export function ContinueWatchingRail({ items }: { items: LibraryCard[] }) {
  const [visible, setVisible] = useState(items);

  function handleDismiss(id: string) {
    setVisible((prev) => prev.filter((item) => item.id !== id));
    void fetch("/api/library/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metaId: id }),
    }).catch(() => {});
  }

  if (visible.length === 0) return null;

  return (
    <Rail title="Continue Watching">
      {visible.map((item) => (
        <PosterCardLink
          key={item.id}
          href={item.href}
          title={item.title}
          posterUrl={item.posterUrl}
          progress={item.progress}
          onDismiss={() => handleDismiss(item.id)}
          dismissLabel={`Remove ${item.title} from Continue Watching`}
        />
      ))}
    </Rail>
  );
}
