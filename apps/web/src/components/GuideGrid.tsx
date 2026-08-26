"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Channel, ChannelCategory, EpgNowNext } from "@skybox/core/shared";
import { Player } from "./Player";
import shared from "./shared.module.css";
import styles from "./GuideGrid.module.css";

export interface GuideGridProps {
  channels: Channel[];
  categories: ChannelCategory[];
  /** Precomputed now/next per `Channel.epgChannelId` (computed server-side against the real EpgStore). Channels with no `epgChannelId`, or no EPG match, simply have no entry here — rows handle that as an empty block, never "undefined" (OQ-14). */
  nowNextByEpgId: Record<string, EpgNowNext>;
}

/** Fixed row height drives the virtualization math below — keep in sync with GuideGrid.module.css .row. */
const ROW_HEIGHT = 76;
/** Height of the sticky timeline header living inside the scroll container — keep in sync with .timelineHeader. */
const TIMELINE_HEADER_HEIGHT = 44;
const OVERSCAN_ROWS = 6;

function channelKey(channel: Channel): string {
  return `${channel.providerId}:${channel.id}`;
}

function useViewportHeight<T extends HTMLElement>(ref: React.RefObject<T | null>): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setHeight(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

function hourTicks(from: number, count: number): string[] {
  const labels: string[] = [];
  const start = new Date(from);
  start.setMinutes(0, 0, 0);
  for (let i = 0; i < count; i++) {
    const tickDate = new Date(start.getTime() + i * 60 * 60 * 1000);
    labels.push(tickDate.toLocaleTimeString(undefined, { hour: "numeric" }));
  }
  return labels;
}

/**
 * TV-guide surface — DESIGN-BRIEF.md LT-01/Plex: pill category filter above
 * a sticky timeline header above windowed channel rows. Real channel/EPG
 * data flows in from `getIptvSnapshot()` via the server page component;
 * this component never fetches on its own. Selecting a row opens the
 * shared `<Player>` in live mode with channel-zap wired to Up/Down through
 * the currently filtered channel list (docs/05-UX.md Player spec).
 */
export function GuideGrid({ channels, categories, nowNextByEpgId }: GuideGridProps) {
  const defaultCategoryId = categories[0]?.id ?? channels[0]?.category ?? "";
  const [categoryId, setCategoryId] = useState(defaultCategoryId);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  // Which of the selected channel's streamUrls (candidate mirrors) is
  // currently playing — a channel that fails on one mirror often plays
  // fine on another (mirrors aren't uniformly reliable for actually
  // serving streams even when they answer the API fine), so a failure
  // retries down the list before giving up on the channel entirely.
  const [sourceIndex, setSourceIndex] = useState(0);
  // Starts at a fixed sentinel (never `Date.now()`) so server and client
  // render byte-identical markup on the first pass — computing "now" in a
  // useState initializer runs on both sides at slightly different instants
  // and is a classic hydration-mismatch source (progress-bar width off by a
  // fraction of a percent). The real clock is set client-side in the effect
  // below, one tick after mount, which is not a hydration error.
  const [tick, setTick] = useState(0);

  // Keeps now/next progress bars and remaining-time labels fresh without a
  // full refetch — cheap client-side clock tick, no network involved.
  useEffect(() => {
    setTick(Date.now());
    const interval = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const filteredChannels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    // A non-empty search escapes the category filter and matches across
    // every channel by name — more useful than a scoped search, and still
    // just a client-side substring match per the spec.
    const source = query.length > 0 ? channels : channels.filter((c) => c.category === categoryId);
    if (query.length === 0) return source;
    return source.filter((c) => c.name.toLowerCase().includes(query));
  }, [channels, categoryId, searchQuery]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const viewportHeight = useViewportHeight(scrollRef);

  // Reset scroll position whenever the visible list changes shape so stale
  // scrollTop from a longer list doesn't leave the new list mid-scroll.
  useEffect(() => {
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [categoryId, searchQuery]);

  const totalRowsHeight = filteredChannels.length * ROW_HEIGHT;
  const rawStart = Math.floor((scrollTop - TIMELINE_HEADER_HEIGHT) / ROW_HEIGHT) - OVERSCAN_ROWS;
  const startIndex = Math.max(0, rawStart);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN_ROWS * 2;
  const endIndex = Math.min(filteredChannels.length, startIndex + visibleCount);
  const visibleChannels = filteredChannels.slice(startIndex, endIndex);

  const selectedIndex = selectedKey ? filteredChannels.findIndex((c) => channelKey(c) === selectedKey) : -1;
  const selectedChannel = selectedIndex >= 0 ? filteredChannels[selectedIndex] : null;

  function selectChannel(channel: Channel) {
    setFailureMessage(null);
    setSourceIndex(0);
    setSelectedKey(channelKey(channel));
  }

  function moveBy(delta: number) {
    if (filteredChannels.length === 0) return;
    const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const nextIndex = (currentIndex + delta + filteredChannels.length) % filteredChannels.length;
    const nextChannel = filteredChannels[nextIndex];
    if (nextChannel) {
      setSourceIndex(0);
      setSelectedKey(channelKey(nextChannel));
    }
  }

  function handleSourceFailed() {
    if (selectedChannel && sourceIndex + 1 < selectedChannel.streamUrls.length) {
      setSourceIndex((i) => i + 1);
      return;
    }
    if (selectedChannel) {
      setFailureMessage(`${selectedChannel.name} is unavailable right now. Pick another channel below.`);
    }
    setSelectedKey(null);
  }

  const selectedNowNext =
    selectedChannel?.epgChannelId !== undefined ? (nowNextByEpgId[selectedChannel.epgChannelId] ?? null) : null;

  const ticks = useMemo(() => (tick > 0 ? hourTicks(tick, 4) : ["", "", "", ""]), [tick]);

  return (
    <div className={styles.guide}>
      <div className={styles.filters}>
        <div className={styles.pills} aria-label="Channel categories">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              aria-pressed={category.id === categoryId}
              className={`${styles.pill} ${category.id === categoryId ? styles.pillActive : ""}`}
              onClick={() => setCategoryId(category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>
        <label className={styles.searchLabel}>
          <span className={styles.srOnly}>Search channels</span>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search channels"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>
      </div>

      {failureMessage && (
        <p className={styles.failureBanner} role="alert">
          {failureMessage}
        </p>
      )}

      <div
        ref={scrollRef}
        className={styles.rowsViewport}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className={styles.timelineHeader} aria-hidden="true">
          {ticks.map((label, i) => (
            <span key={i} className={styles.timelineTick}>
              {i === 0 ? "Now" : label}
            </span>
          ))}
        </div>

        {filteredChannels.length === 0 ? (
          <p className={styles.emptyList}>No channels match. Try a different category or search.</p>
        ) : (
          <div className={styles.rowsInner} style={{ height: totalRowsHeight }}>
            {visibleChannels.map((channel, i) => {
              const index = startIndex + i;
              const nowNext = channel.epgChannelId !== undefined ? nowNextByEpgId[channel.epgChannelId] : undefined;
              return (
                <ChannelRow
                  key={channelKey(channel)}
                  channel={channel}
                  nowNext={nowNext ?? null}
                  now={tick}
                  top={index * ROW_HEIGHT}
                  selected={channelKey(channel) === selectedKey}
                  onSelect={() => selectChannel(channel)}
                />
              );
            })}
          </div>
        )}
      </div>

      {selectedChannel && (
        <div className={styles.playerOverlay}>
          <Player
            source={{ url: selectedChannel.streamUrls[sourceIndex]!, format: "hls" }}
            title={selectedChannel.name}
            poster={selectedChannel.logo}
            live={{
              channelName: selectedChannel.name,
              channelLogo: selectedChannel.logo,
              nowNext: selectedNowNext,
              onChannelUp: () => moveBy(-1),
              onChannelDown: () => moveBy(1),
            }}
            onClose={() => setSelectedKey(null)}
            onSourceFailed={handleSourceFailed}
          />
        </div>
      )}
    </div>
  );
}

function ChannelRow({
  channel,
  nowNext,
  now,
  top,
  selected,
  onSelect,
}: {
  channel: Channel;
  nowNext: EpgNowNext | null;
  now: number;
  top: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const current = nowNext?.now ?? null;
  const next = nowNext?.next ?? null;
  // `now === 0` is the pre-hydration sentinel (see the `tick` state comment
  // in GuideGrid above) — treat it as "clock not ready yet" rather than
  // computing nonsense against the epoch.
  const clockReady = now > 0;
  const progress =
    clockReady && current ? Math.min(1, Math.max(0, (now - current.start) / (current.stop - current.start))) : 0;
  const remainingMin = clockReady && current ? Math.max(0, Math.round((current.stop - now) / 60_000)) : null;

  return (
    <button
      type="button"
      className={`${styles.row} ${shared.focusLift} ${selected ? styles.rowSelected : ""}`}
      style={{ top }}
      onClick={onSelect}
    >
      <span className={styles.channelIdentity}>
        {channel.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={channel.logo} alt="" className={styles.channelLogo} />
        ) : (
          <span className={styles.channelLogoFallback} aria-hidden="true">
            {channel.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className={styles.channelName}>{channel.name}</span>
      </span>

      <span className={styles.programBlock}>
        {current ? (
          <>
            <span className={styles.programTitle}>{current.title}</span>
            <span className={styles.programMeta}>
              <span className={styles.progressTrack} aria-hidden="true">
                <span className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
              </span>
              {remainingMin !== null && <span className={styles.remaining}>{remainingMin} min left</span>}
            </span>
            {next && <span className={styles.nextTitle}>Next: {next.title}</span>}
          </>
        ) : (
          <span className={styles.programUnknown}>No program info</span>
        )}
      </span>
    </button>
  );
}
