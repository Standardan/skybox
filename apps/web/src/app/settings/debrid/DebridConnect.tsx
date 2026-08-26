"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DebridAccountStatus, DebridProviderId } from "@skybox/core/shared";
import styles from "../settings.module.css";

interface DebridConnectProps {
  initialAccount: DebridAccountStatus | null;
  initialProvider: DebridProviderId | null;
}

const PROVIDERS: Array<{
  id: DebridProviderId;
  label: string;
  authMethod: "device" | "apikey";
  keyHint: string;
  /**
   * Real-Debrid's device-code step has been observed getting rejected
   * (404) when it comes from a datacenter/VPS IP, even though the same
   * request works fine from a residential connection — an anti-abuse
   * measure on their end. A pasted private API token (real-debrid.com/
   * apitoken) authenticates identically and sidesteps that endpoint
   * entirely, so it's offered as a fallback alongside the normal flow.
   */
  apiKeyFallback?: boolean;
}> = [
  {
    id: "real-debrid",
    label: "Real-Debrid",
    authMethod: "device",
    keyHint: "Found at real-debrid.com/apitoken — use this if the normal connect button fails, which can happen when Skybox runs on a VPS.",
    apiKeyFallback: true,
  },
  { id: "alldebrid", label: "AllDebrid", authMethod: "device", keyHint: "" },
  { id: "premiumize", label: "Premiumize", authMethod: "apikey", keyHint: "Found under My Account on premiumize.me" },
  { id: "torbox", label: "TorBox", authMethod: "apikey", keyHint: "Found under Settings → API Key on torbox.app" },
];

type DeviceInfo = {
  verificationUrl: string;
  userCode: string;
  deviceCode: string;
  expiresIn: number;
  interval: number;
};

type FlowState =
  | { phase: "picking" }
  | { phase: "showing-code"; device: DeviceInfo }
  | { phase: "waiting"; device: DeviceInfo }
  | { phase: "entering-key" }
  | { phase: "connecting-key" }
  | { phase: "error"; message: string }
  | { phase: "connected" };

function formatPremiumUntil(premiumUntil: number | null): string {
  if (premiumUntil === null) return "Free account";
  const date = new Date(premiumUntil);
  return `Premium until ${date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`;
}

export function DebridConnect({ initialAccount, initialProvider }: DebridConnectProps) {
  const router = useRouter();
  const [account, setAccount] = useState(initialAccount);
  const [connectedProvider, setConnectedProvider] = useState(initialProvider);
  const [provider, setProvider] = useState<DebridProviderId>(initialProvider ?? "real-debrid");
  const [flow, setFlow] = useState<FlowState>({ phase: "picking" });
  const abortRef = useRef<AbortController | null>(null);

  const providerLabel = (id: DebridProviderId) => PROVIDERS.find((p) => p.id === id)?.label ?? id;

  async function startConnect(chosen: DebridProviderId) {
    setProvider(chosen);
    setFlow({ phase: "picking" });
    const meta = PROVIDERS.find((p) => p.id === chosen)!;
    if (meta.authMethod === "apikey") {
      setFlow({ phase: "entering-key" });
      return;
    }
    try {
      const res = await fetch("/api/settings/debrid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", provider: chosen }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFlow({ phase: "error", message: data.error ?? "Could not start the connection." });
        return;
      }
      setFlow({ phase: "showing-code", device: data });
    } catch {
      setFlow({ phase: "error", message: "Could not reach the server. Try again." });
    }
  }

  async function beginPolling(device: DeviceInfo) {
    setFlow({ phase: "waiting", device });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/settings/debrid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "poll",
          provider,
          deviceCode: device.deviceCode,
          expiresIn: device.expiresIn,
          interval: device.interval,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (data.status === "connected") {
        setAccount(data.account);
        setConnectedProvider(provider);
        setFlow({ phase: "connected" });
        router.refresh();
      } else {
        setFlow({ phase: "error", message: data.message ?? "Could not confirm the connection." });
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setFlow({ phase: "showing-code", device });
      } else {
        setFlow({ phase: "error", message: "Lost connection to the server while waiting." });
      }
    }
  }

  function cancelWaiting(device: DeviceInfo) {
    abortRef.current?.abort();
    setFlow({ phase: "showing-code", device });
  }

  function enterKeyManually(chosen: DebridProviderId) {
    setProvider(chosen);
    setFlow({ phase: "entering-key" });
  }

  async function connectWithKey(apiKey: string) {
    setFlow({ phase: "connecting-key" });
    try {
      const res = await fetch("/api/settings/debrid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect-apikey", provider, apiKey }),
      });
      const data = await res.json();
      if (data.status === "connected") {
        setAccount(data.account);
        setConnectedProvider(provider);
        setFlow({ phase: "connected" });
        router.refresh();
      } else {
        setFlow({ phase: "error", message: data.message ?? data.error ?? "Could not verify that key." });
      }
    } catch {
      setFlow({ phase: "error", message: "Could not reach the server. Try again." });
    }
  }

  async function disconnect() {
    await fetch("/api/settings/debrid", { method: "DELETE" });
    setAccount(null);
    setConnectedProvider(null);
    setFlow({ phase: "picking" });
    router.refresh();
  }

  if (account) {
    return (
      <section className={styles.panelPadded}>
        <p className={styles.successText} role="status">
          Connected to {connectedProvider ? providerLabel(connectedProvider) : "your debrid provider"} as{" "}
          {account.username}
        </p>
        <p className={styles.fieldHint}>{formatPremiumUntil(account.premiumUntil)}</p>
        <div style={{ marginTop: "var(--space-4)" }}>
          <button type="button" className={`${styles.buttonGhost} ${styles.danger}`} onClick={disconnect}>
            Disconnect
          </button>
        </div>
      </section>
    );
  }

  if (flow.phase === "showing-code" || flow.phase === "waiting") {
    const { device } = flow;
    return (
      <section className={styles.panelPadded}>
        <p className={styles.fieldLabel}>Go to</p>
        <p style={{ fontSize: "var(--text-lg)", margin: "0 0 var(--space-3)" }}>
          <a href={device.verificationUrl} target="_blank" rel="noreferrer">
            {device.verificationUrl}
          </a>
        </p>
        <p className={styles.fieldLabel}>Enter this code</p>
        <p
          style={{
            fontFamily: "var(--font-third)",
            fontSize: "var(--text-3xl)",
            letterSpacing: "0.08em",
            fontWeight: 700,
            margin: "0 0 var(--space-4)",
          }}
        >
          {device.userCode}
        </p>
        {flow.phase === "waiting" ? (
          <>
            <p className={styles.fieldHint} role="status">
              Waiting for you to authorize on {providerLabel(provider)}&hellip; this can take a few minutes.
            </p>
            <button
              type="button"
              className={styles.buttonGhost}
              style={{ marginTop: "var(--space-3)" }}
              onClick={() => cancelWaiting(device)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className={styles.buttonPrimary} onClick={() => beginPolling(device)}>
            I&apos;ve entered the code
          </button>
        )}
      </section>
    );
  }

  if (flow.phase === "entering-key" || flow.phase === "connecting-key") {
    const meta = PROVIDERS.find((p) => p.id === provider)!;
    return (
      <section className={styles.panelPadded}>
        <p className={styles.fieldLabel}>{meta.label} API key</p>
        {meta.keyHint ? <p className={styles.fieldHint}>{meta.keyHint}</p> : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const input = new FormData(e.currentTarget).get("apiKey");
            if (typeof input === "string" && input.trim()) connectWithKey(input.trim());
          }}
          style={{ marginTop: "var(--space-3)" }}
        >
          <input
            name="apiKey"
            type="password"
            autoComplete="off"
            className={styles.input}
            placeholder="Paste your API key"
            disabled={flow.phase === "connecting-key"}
            style={{ width: "100%" }}
          />
          <div className={styles.row} style={{ marginTop: "var(--space-3)" }}>
            <button type="submit" className={styles.buttonPrimary} disabled={flow.phase === "connecting-key"}>
              {flow.phase === "connecting-key" ? "Verifying…" : "Connect"}
            </button>
            <button
              type="button"
              className={styles.buttonGhost}
              disabled={flow.phase === "connecting-key"}
              onClick={() => setFlow({ phase: "picking" })}
            >
              Back
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className={styles.panelPadded}>
      {flow.phase === "error" ? (
        <p className={styles.errorText} role="alert">
          {flow.message}
        </p>
      ) : null}
      <p className={styles.fieldLabel}>Choose your debrid provider</p>
      <div style={{ marginTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {PROVIDERS.map((p) => (
          <div key={p.id} className={styles.row} style={{ alignItems: "baseline" }}>
            <button type="button" className={styles.buttonPrimary} onClick={() => startConnect(p.id)}>
              Connect {p.label}
            </button>
            {p.apiKeyFallback ? (
              <button type="button" className={styles.buttonGhost} onClick={() => enterKeyManually(p.id)}>
                or paste an API token instead
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
