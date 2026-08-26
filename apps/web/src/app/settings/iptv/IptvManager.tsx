"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { IptvProvider, ChannelCategory } from "@skybox/core/shared";
import { SettingsRow, Switch } from "@/components/SettingsRow";
import styles from "../settings.module.css";

interface IptvManagerProps {
  initialProviders: IptvProvider[];
}

function providerSummary(provider: IptvProvider): string {
  if (provider.type === "xtream") {
    return `Xtream · ${provider.baseUrls.length} mirror${provider.baseUrls.length === 1 ? "" : "s"} · ${provider.username}`;
  }
  return `M3U · ${provider.m3uUrl}`;
}

export function IptvManager({ initialProviders }: IptvManagerProps) {
  const router = useRouter();
  const [providers, setProviders] = useState(initialProviders);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleRemove(id: string) {
    setBusyId(id);
    try {
      const res = await fetch("/api/settings/iptv", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (res.ok) {
        setProviders(data.iptv);
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Providers</h2>
        {providers.length === 0 ? (
          <p className={styles.emptyState}>No Live TV provider configured yet.</p>
        ) : (
          <div className={styles.panel}>
            {providers.map((provider) => (
              <div key={provider.id}>
                <SettingsRow label={provider.label} hint={providerSummary(provider)}>
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <button
                      type="button"
                      className={styles.buttonGhost}
                      onClick={() => setExpandedId(expandedId === provider.id ? null : provider.id)}
                    >
                      {expandedId === provider.id ? "Close" : "Categories"}
                    </button>
                    <button
                      type="button"
                      className={`${styles.buttonGhost} ${styles.danger}`}
                      disabled={busyId === provider.id}
                      onClick={() => handleRemove(provider.id)}
                    >
                      Remove
                    </button>
                  </div>
                </SettingsRow>
                {expandedId === provider.id ? <CategoryEditor providerId={provider.id} /> : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <AddProviderForm
        onAdded={(provider) => {
          setProviders((prev) => [...prev, provider]);
          router.refresh();
        }}
      />
    </>
  );
}

function CategoryEditor({ providerId }: { providerId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ChannelCategory[]>([]);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/settings/iptv?id=${encodeURIComponent(providerId)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Could not load categories.");
          return;
        }
        const hidden = new Set<string>(data.hiddenCategories ?? []);
        setCategories(data.categories);
        setVisible(new Set(data.categories.filter((c: ChannelCategory) => !hidden.has(c.id)).map((c: ChannelCategory) => c.id)));
      } catch {
        if (!cancelled) setError("Could not reach the server.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const hiddenCategories = categories.filter((c) => !visible.has(c.id)).map((c) => c.id);
      const res = await fetch("/api/settings/iptv", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: providerId, hiddenCategories }),
      });
      if (res.ok) setSaved(true);
      else {
        const data = await res.json();
        setError(data.error ?? "Could not save.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className={styles.emptyState}>Loading categories&hellip;</p>;
  if (error)
    return (
      <p className={styles.errorText} role="alert">
        {error}
      </p>
    );

  return (
    <div className={styles.panelPadded} style={{ marginTop: "var(--space-2)", marginBottom: "var(--space-4)" }}>
      <p className={styles.fieldHint} style={{ marginBottom: "var(--space-3)" }}>
        Hide categories you never watch. Unchecked categories are hidden everywhere in the app.
      </p>
      <div className={styles.row} style={{ marginBottom: "var(--space-3)" }}>
        <button
          type="button"
          className={styles.buttonGhost}
          onClick={() => {
            setVisible(new Set(categories.map((c) => c.id)));
            setSaved(false);
          }}
          disabled={visible.size === categories.length}
        >
          Select all
        </button>
        <button
          type="button"
          className={styles.buttonGhost}
          onClick={() => {
            setVisible(new Set());
            setSaved(false);
          }}
          disabled={visible.size === 0}
        >
          Deselect all
        </button>
        <span className={styles.fieldHint} style={{ alignSelf: "center" }}>
          {visible.size} of {categories.length} shown
        </span>
      </div>
      {categories.map((category) => {
        const id = `cat-${providerId}-${category.id}`;
        return (
          <SettingsRow key={category.id} label={category.name} htmlFor={id}>
            <Switch
              id={id}
              checked={visible.has(category.id)}
              onChange={(checked) => {
                setVisible((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(category.id);
                  else next.delete(category.id);
                  return next;
                });
                setSaved(false);
              }}
            />
          </SettingsRow>
        );
      })}
      <div style={{ marginTop: "var(--space-3)", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <button type="button" className={styles.buttonPrimary} onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save categories"}
        </button>
        {saved ? <span className={styles.successText}>Saved</span> : null}
      </div>
    </div>
  );
}

function AddProviderForm({ onAdded }: { onAdded: (provider: IptvProvider) => void }) {
  const [type, setType] = useState<"xtream" | "m3u">("xtream");
  const [label, setLabel] = useState("");
  const [baseUrls, setBaseUrls] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [m3uUrl, setM3uUrl] = useState("");
  const [epgUrl, setEpgUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const body =
        type === "xtream"
          ? {
              type,
              label,
              baseUrls: baseUrls
                .split(/[\n,]/)
                .map((u) => u.trim())
                .filter(Boolean),
              username,
              password,
            }
          : { type, label, m3uUrl, epgUrl: epgUrl.trim() || undefined };

      const res = await fetch("/api/settings/iptv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not add that provider.");
        return;
      }
      onAdded(data.provider);
      setSuccess(`Added ${data.provider.label}.`);
      setLabel("");
      setBaseUrls("");
      setUsername("");
      setPassword("");
      setM3uUrl("");
      setEpgUrl("");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Add provider</h2>
      <form onSubmit={handleSubmit} className={styles.panelPadded}>
        <fieldset style={{ border: "none", padding: 0, margin: "0 0 var(--space-4)" }}>
          <legend className={styles.fieldLabel} style={{ marginBottom: "var(--space-2)" }}>
            Provider type
          </legend>
          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <input type="radio" name="iptv-type" checked={type === "xtream"} onChange={() => setType("xtream")} />
              Xtream
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <input type="radio" name="iptv-type" checked={type === "m3u"} onChange={() => setType("m3u")} />
              M3U
            </label>
          </div>
        </fieldset>

        <div className={styles.field}>
          <label htmlFor="iptv-label" className={styles.fieldLabel}>
            Label
          </label>
          <input
            id="iptv-label"
            type="text"
            className={styles.input}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="My IPTV"
          />
        </div>

        {type === "xtream" ? (
          <>
            <div className={styles.field}>
              <label htmlFor="iptv-baseurls" className={styles.fieldLabel}>
                Server URL(s)
              </label>
              <textarea
                id="iptv-baseurls"
                className={styles.input}
                style={{ minHeight: 72, resize: "vertical" }}
                value={baseUrls}
                onChange={(e) => setBaseUrls(e.target.value)}
                placeholder={"http://server1.example.com:8080\nhttp://server2.example.com:8080"}
              />
              <p className={styles.fieldHint}>One per line. Extra mirrors are tried automatically if the first fails.</p>
            </div>
            <div className={styles.field}>
              <label htmlFor="iptv-username" className={styles.fieldLabel}>
                Username
              </label>
              <input
                id="iptv-username"
                type="text"
                className={styles.input}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="iptv-password" className={styles.fieldLabel}>
                Password
              </label>
              <input
                id="iptv-password"
                type="password"
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </div>
          </>
        ) : (
          <>
            <div className={styles.field}>
              <label htmlFor="iptv-m3u" className={styles.fieldLabel}>
                M3U URL
              </label>
              <input
                id="iptv-m3u"
                type="url"
                className={styles.input}
                value={m3uUrl}
                onChange={(e) => setM3uUrl(e.target.value)}
                placeholder="https://example.com/playlist.m3u"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="iptv-epg" className={styles.fieldLabel}>
                EPG URL (optional)
              </label>
              <input
                id="iptv-epg"
                type="url"
                className={styles.input}
                value={epgUrl}
                onChange={(e) => setEpgUrl(e.target.value)}
                placeholder="https://example.com/epg.xml"
              />
            </div>
          </>
        )}

        {error ? (
          <p className={styles.errorText} role="alert">
            {error}
          </p>
        ) : null}
        {success ? <p className={styles.successText}>{success}</p> : null}

        <button type="submit" className={styles.buttonPrimary} disabled={busy}>
          {busy ? "Verifying…" : "Add provider"}
        </button>
      </form>
    </section>
  );
}
