"use client";

import { useRouter } from "next/navigation";
import { PosterCard } from "./PosterCard";

/**
 * PosterCard renders a bare `<button>` with no navigation affordance (it's
 * decorative-only in the current Home demo). Catalog/search/detail pages
 * need it to navigate to the title detail page. Wrapping it in a Next
 * `<Link>` would nest a `<button>` inside an `<a>` — invalid HTML and two
 * conflicting focus stops for one visual card. Instead this wraps it in a
 * plain (non-interactive) container and forwards the inner button's click
 * (mouse click, or Enter/Space while focused) up to a router navigation,
 * keeping PosterCard's single focus-lift button as the only tab stop.
 *
 * Trade-off: this is not a real `<a href>`, so middle-click/"open in new
 * tab" doesn't work — a limitation inherited from PosterCard being a
 * `<button>` rather than a link, not introduced here.
 */
export function PosterCardLink({
  href,
  title,
  posterUrl,
  progress,
  onDismiss,
  dismissLabel,
}: {
  href: string;
  title: string;
  posterUrl: string;
  progress?: number;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  const router = useRouter();
  return (
    <div onClick={() => router.push(href)}>
      <PosterCard
        title={title}
        posterUrl={posterUrl}
        progress={progress}
        onDismiss={onDismiss}
        dismissLabel={dismissLabel}
      />
    </div>
  );
}
