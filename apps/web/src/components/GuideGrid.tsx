"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Channel, ChannelCategory, EpgNowNext } from "@skybox/core/shared";
import { applyCustomOrder, reorder } from "@skybox/core/iptv";
import { Player } from "./Player";
import shared from "./shared.module.css";
import styles from "./GuideGrid.module.css";

export interface LiveTvPrefs {
  favoriteChannelKeys: string[];
  categoryOrder: string[];
  channelOrder: Record<string, string[]>;
}

export interface GuideGridProps {
  channels: Channel[];
  categories: ChannelCategory[];
  /** Precomputed now/next per `Channel.epgChannelId` (computed server-side against the real EpgStore). Channels with no `epgChannelId`, or no EPG match, simply have no entry here — rows handle that as an empty block, never "undefined" (OQ-14). */
  nowNextByEpgId: Record<string, EpgNowNext>;
  initialPrefs: LiveTvPrefs;
}

/** Fixed row height drives the virtualization math below — keep in sync with GuideGrid.module.css .row. */
const ROW_HEIGHT = 76;
/** Height of the sticky timeline header living inside the scroll container — keep in sync with .timelineHeader. */
const TIMELINE_HEADER_HEIGHT = 44;
const OVERSCAN_ROWS = 6;
/** Synthetic category id, always pinned first — real categories never legitimately collide with this since real ids come straight from the provider's own category_id. */
const FAVORITES_ID = "__favorites__";

function channelKey(channel: Channel): string {
  return `${channel.providerId}:${channel.id}`;
}

async function postPrefs(body: unknown): Promise<LiveTvPrefs> {
  const res = await fetch("/api/live-tv-prefs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as LiveTvPrefs;
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
 *
 * Per-account customization (favorites + manual category/channel order):
 * a synthetic "Favorites" pill is always pinned first; every other
 * category can be dragged into a custom order, and channels within a
 * (non-favorites, non-searched) category can likewise be dragged into a
 * custom order — both persisted per account via /api/live-tv-prefs and
 * merged back on top of the provider's own order (applyCustomOrder), so a
 * category/channel the user never touched just keeps its provider
 * position rather than needing a complete saved order up front.
 */
export function GuideGrid({ channels, categories, nowNextByEpgId, initialPrefs }: GuideGridProps) {
  const [prefs, setPrefs] = useState(initialPrefs);
  const orderedCategories = useMemo(
    () => applyCustomOrder(categories, (c) => c.id, prefs.categoryOrder),
    [categories, prefs.categoryOrder],
  );
  const defaultCategoryId = FAVORITES_ID;
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
  // State drives the visual "dragging" dim; the ref is what drop logic
  // actually reads. A native drag can fire dragstart -> dragover -> drop in
  // the same tick faster than React flushes the setDragged state update,
  // so a drop handler closing over the *state* value can still see the
  // pre-drag `null` and silently no-op — the ref is always current.
  const [dragged, setDragged] = useState<{ kind: "category" | "channel"; id: string } | null>(null);
  const draggedRef = useRef<{ kind: "category" | "channel"; id: string } | null>(null);

  function beginDrag(kind: "category" | "channel", id: string) {
    draggedRef.current = { kind, id };
    setDragged({ kind, id });
  }

  function endDrag() {
    draggedRef.current = null;
    setDragged(null);
  }

  // Keeps now/next progress bars and remaining-time labels fresh without a
  // full refetch — cheap client-side clock tick, no network involved.
  useEffect(() => {
    setTick(Date.now());
    const interval = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const channelByKey = useMemo(() => new Map(channels.map((c) => [channelKey(c), c])), [channels]);
  const favoriteChannels = useMemo(
    () => prefs.favoriteChannelKeys.map((key) => channelByKey.get(key)).filter((c): c is Channel => Boolean(c)),
    [prefs.favoriteChannelKeys, channelByKey],
  );

  const isFavoritesTab = categoryId === FAVORITES_ID;
  // Reordering only makes unambiguous sense against one concrete, known
  // provider-order list — search results can span many categories at
  // once, so dragging is disabled while a search query is active.
  const canReorderChannels = !isFavoritesTab && searchQuery.trim().length === 0;

  const filteredChannels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    // A non-empty search escapes the category filter and matches across
    // every channel by name — more useful than a scoped search, and still
    // just a client-side substring match per the spec.
    if (query.length > 0) return channels.filter((c) => c.name.toLowerCase().includes(query));
    if (isFavoritesTab) return favoriteChannels;
    const inCategory = channels.filter((c) => c.category === categoryId);
    return applyCustomOrder(inCategory, channelKey, prefs.channelOrder[categoryId] ?? []);
  }, [channels, categoryId, searchQuery, isFavoritesTab, favoriteChannels, prefs.channelOrder]);

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

  function toggleFavorite(channel: Channel) {
    const key = channelKey(channel);
    // Optimistic — favoriting should feel instant, and the server response
    // (the real, authoritative new list) replaces this a moment later.
    setPrefs((p) => ({
      ...p,
      favoriteChannelKeys: p.favoriteChannelKeys.includes(key)
        ? p.favoriteChannelKeys.filter((k) => k !== key)
        : [...p.favoriteChannelKeys, key],
    }));
    void postPrefs({ action: "toggle-favorite", channelKey: key }).then(setPrefs);
  }

  function handleCategoryDrop(targetId: string) {
    const current = draggedRef.current;
    if (!current || current.kind !== "category" || current.id === targetId) return;
    const providerOrderIds = categories.map((c) => c.id);
    setPrefs((p) => ({ ...p, categoryOrder: reorder(p.categoryOrder, providerOrderIds, current.id, targetId) }));
    void postPrefs({
      action: "reorder-categories",
      movedId: current.id,
      beforeId: targetId,
      providerOrderIds,
    }).then(setPrefs);
    endDrag();
  }

  function handleChannelDrop(targetChannel: Channel) {
    const targetKey = channelKey(targetChannel);
    const current = draggedRef.current;
    if (!current || current.kind !== "channel" || current.id === targetKey) return;
    const providerOrderIds = channels.filter((c) => c.category === categoryId).map(channelKey);
    setPrefs((p) => ({
      ...p,
      channelOrder: {
        ...p.channelOrder,
        [categoryId]: reorder(p.channelOrder[categoryId] ?? [], providerOrderIds, current.id, targetKey),
      },
    }));
    void postPrefs({
      action: "reorder-channels",
      categoryId,
      movedId: current.id,
      beforeId: targetKey,
      providerOrderIds,
    }).then(setPrefs);
    endDrag();
  }

  const selectedNowNext =
    selectedChannel?.epgChannelId !== undefined ? (nowNextByEpgId[selectedChannel.epgChannelId] ?? null) : null;

  const ticks = useMemo(() => (tick > 0 ? hourTicks(tick, 4) : ["", "", "", ""]), [tick]);

  return (
    <div className={styles.guide}>
      <div className={styles.filters}>
        <div className={styles.pills} aria-label="Channel categories">
          <button
            type="button"
            aria-pressed={isFavoritesTab}
            className={`${styles.pill} ${styles.pillFavorites} ${isFavoritesTab ? styles.pillActive : ""}`}
            onClick={() => setCategoryId(FAVORITES_ID)}
          >
            ★ Favorites
          </button>
          {orderedCategories.map((category) => (
            <button
              key={category.id}
              type="button"
              draggable
              aria-pressed={category.id === categoryId}
              className={`${styles.pill} ${category.id === categoryId ? styles.pillActive : ""} ${dragged?.kind === "category" && dragged.id === category.id ? styles.dragging : ""}`}
              onClick={() => setCategoryId(category.id)}
              onDragStart={() => beginDrag("category", category.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleCategoryDrop(category.id);
              }}
              onDragEnd={endDrag}
              title="Drag to reorder"
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
          <p className={styles.emptyList}>
            {isFavoritesTab && searchQuery.trim().length === 0
              ? "No favorites yet — click the star on a channel to add it here."
              : "No channels match. Try a different category or search."}
          </p>
        ) : (
          <div className={styles.rowsInner} style={{ height: totalRowsHeight }}>
            {visibleChannels.map((channel, i) => {
              const index = startIndex + i;
              const key = channelKey(channel);
              const nowNext = channel.epgChannelId !== undefined ? nowNextByEpgId[channel.epgChannelId] : undefined;
              return (
                <ChannelRow
                  key={key}
                  channel={channel}
                  nowNext={nowNext ?? null}
                  now={tick}
                  top={index * ROW_HEIGHT}
                  selected={key === selectedKey}
                  favorite={prefs.favoriteChannelKeys.includes(key)}
                  draggable={canReorderChannels}
                  dragging={dragged?.kind === "channel" && dragged.id === key}
                  onSelect={() => selectChannel(channel)}
                  onToggleFavorite={() => toggleFavorite(channel)}
                  onDragStart={() => beginDrag("channel", key)}
                  onDrop={() => handleChannelDrop(channel)}
                  onDragEnd={endDrag}
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
  favorite,
  draggable,
  dragging,
  onSelect,
  onToggleFavorite,
  onDragStart,
  onDrop,
  onDragEnd,
}: {
  channel: Channel;
  nowNext: EpgNowNext | null;
  now: number;
  top: number;
  selected: boolean;
  favorite: boolean;
  draggable: boolean;
  dragging: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onDragStart: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
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
    <div
      className={`${styles.row} ${selected ? styles.rowSelected : ""} ${dragging ? styles.dragging : ""}`}
      style={{ top }}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => draggable && e.preventDefault()}
      onDrop={(e) => {
        if (!draggable) return;
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        className={styles.favoriteToggle}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        aria-pressed={favorite}
        aria-label={favorite ? `Remove ${channel.name} from favorites` : `Add ${channel.name} to favorites`}
      >
        {favorite ? "★" : "☆"}
      </button>

      <button type="button" className={`${styles.rowMain} ${shared.focusLift}`} onClick={onSelect}>
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
    </div>
  );
}
