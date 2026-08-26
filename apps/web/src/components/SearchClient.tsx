"use client";

import { useEffect, useRef, useState } from "react";
import type { StremioMetaPreview } from "@skybox/core/shared";
import { PosterCardLink } from "@/components/PosterCardLink";
import { cinemetaPosterUrl } from "@/lib/cinemeta";
import styles from "./SearchClient.module.css";

const DEBOUNCE_MS = 300;

interface SearchResponse {
  results: StremioMetaPreview[];
}

export function SearchClient() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse["results"]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    abortRef.current?.abort();

    if (!trimmed) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error("Search request failed.");
          return res.json() as Promise<SearchResponse>;
        })
        .then((data) => {
          setResults(data.results);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError("Search failed. Try again.");
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className={styles.wrap}>
      <h1 className={styles.heading}>Search</h1>
      <div className={styles.inputRow}>
        <label htmlFor="search-input" className={styles.visuallyHidden}>
          Search movies and series
        </label>
        <input
          id="search-input"
          type="search"
          className={styles.input}
          placeholder="Search movies and series"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {loading && <p className={styles.status}>Searching…</p>}
      {!loading && error && <p className={styles.status}>{error}</p>}
      {!loading && !error && query.trim() && results.length === 0 && (
        <p className={styles.status}>No results for &ldquo;{query.trim()}&rdquo;.</p>
      )}

      {!loading && !error && results.length > 0 && (
        <div className={styles.grid}>
          {results.map((item) => (
            <PosterCardLink
              key={`${item.type}:${item.id}`}
              href={`/title/${item.type}/${item.id}`}
              title={item.name}
              posterUrl={cinemetaPosterUrl(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
