import type { ReactNode } from "react";
import { TopNav } from "@/components/TopNav";
import styles from "./settings.module.css";

// Every Settings screen reads live config/account state (config-store,
// debrid provider, IPTV provider) — never statically prerendered. Set once
// here rather than on every subsection page.
export const dynamic = "force-dynamic";

/**
 * Shared shell for every Settings screen. Reference: LT-04 (Linear)
 * restraint — no focus-lift glow here (see SettingsRow.tsx), panels
 * constrained to 640-720px per DESIGN-BRIEF.md §6.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopNav />
      <main className={styles.container}>{children}</main>
    </>
  );
}
