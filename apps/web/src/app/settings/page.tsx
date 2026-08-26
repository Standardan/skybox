import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import styles from "./settings.module.css";

const SECTIONS = [
  { href: "/settings/addons", title: "Addons", hint: "Stremio-compatible addon sources — add, reorder, remove." },
  { href: "/settings/debrid", title: "Debrid", hint: "Connect Real-Debrid, AllDebrid, Premiumize, or TorBox." },
  { href: "/settings/iptv", title: "Live TV providers", hint: "Xtream or M3U providers, and hidden categories." },
  { href: "/settings/sports", title: "Sports", hint: "Leagues, teams, and the spoiler-free toggle." },
  { href: "/settings/playback", title: "Playback", hint: "Quality and subtitle preferences." },
  { href: "/settings/home", title: "Home screen", hint: "Reorder or hide rails, and sports-first layout." },
  { href: "/settings/sync", title: "Devices & Sync", hint: "Export or import your configuration." },
];

export default async function SettingsIndexPage() {
  const user = await getCurrentUser();
  const sections =
    user?.role === "admin"
      ? [
          ...SECTIONS,
          { href: "/settings/users", title: "Users", hint: "Who can sign in, and as an admin or not." },
          { href: "/settings/updates", title: "Updates", hint: "Check for and apply new versions." },
        ]
      : SECTIONS;

  return (
    <>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Settings</h1>
        <p className={styles.pageDescription}>
          Everything here configures services you connect yourself. Skybox includes no content or
          sources of its own.
        </p>
      </div>
      <ul className={styles.indexList}>
        {sections.map((section) => (
          <li key={section.href}>
            <Link href={section.href} className={styles.indexLink}>
              <span className={styles.indexLinkTitle}>{section.title}</span>
              <span className={styles.indexLinkHint}>{section.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
