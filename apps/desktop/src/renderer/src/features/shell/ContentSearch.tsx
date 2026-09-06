import { useEffect, useRef, useState } from "react";
import type { ContentHit } from "@capsule/shared";
import { searchProjectContents } from "../../lib/bridge";
import { useWorkspace } from "../../lib/workspace";
import { SearchIcon } from "./icons";

export function ContentSearch() {
  const { contentSearch, setContentSearch, projectId, sessionId, openFile } = useWorkspace();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [hits, setHits] = useState<ContentHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const searchQueue = useRef(Promise.resolve());

  useEffect(() => {
    setError(undefined);
    if (!contentSearch || !projectId || query.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      // Finish the active read, then run only the newest queued query. Typing
      // must not start a second full scan for every debounce interval.
      searchQueue.current = searchQueue.current.then(async () => {
        if (!current) return;
        try {
          const rows = await searchProjectContents(projectId, query, sessionId);
          if (current) { setHits(rows); setIndex(0); }
        } catch (error) { if (current) setError(error instanceof Error ? error.message : String(error)); }
        finally { if (current) setLoading(false); }
      });
    }, 120);
    let current = true;
    setLoading(true);
    setHits([]);
    return () => { current = false; window.clearTimeout(timer); };
  }, [contentSearch, projectId, sessionId, query, retry]);

  function pick(hit: ContentHit) {
    openFile(hit.path);
    setContentSearch(false);
    setQuery("");
  }

  if (!contentSearch) return null;
  return (
    <div
      className="palette-backdrop"
      onClick={() => {
        setContentSearch(false);
        setQuery("");
      }}
    >
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        <div className="palette-search-row">
          <SearchIcon size={16} />
          <input
            autoFocus
            placeholder="Search in files…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((current) => Math.max(0, Math.min(hits.length - 1, current + 1)));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((current) => Math.max(0, current - 1));
              }
              if (event.key === "Enter" && hits[index]) {
                event.preventDefault();
                pick(hits[index]);
              }
              if (event.key === "Escape") setContentSearch(false);
            }}
          />
        </div>
        <div className="palette-list">
          {loading && <div className="sidebar-empty" role="status">Searching…</div>}
          {error && <div className="notice" role="alert">Search failed: {error} <button type="button" className="chip" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
          {!loading && !error && query.trim().length >= 2 && hits.length === 0 && <div className="sidebar-empty">No matches</div>}
          {hits.map((hit, hitIndex) => (
            <button
              key={`${hit.path}:${hit.line}:${hitIndex}`}
              className={hitIndex === index ? "active" : ""}
              onMouseEnter={() => setIndex(hitIndex)}
              onClick={() => pick(hit)}
            >
              <span className="mono">
                {hit.path}:{hit.line}
              </span>
              <span className="faint"> {hit.text}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
