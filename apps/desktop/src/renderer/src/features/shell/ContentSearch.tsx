import { useEffect, useState } from "react";
import type { ContentHit } from "@capsule/shared";
import { searchProjectContents } from "../../lib/bridge";
import { useWorkspace } from "../../lib/workspace";
import { SearchIcon } from "./icons";

export function ContentSearch() {
  const { contentSearch, setContentSearch, projectId, mentionFile, openInspector } = useWorkspace();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [hits, setHits] = useState<ContentHit[]>([]);

  useEffect(() => {
    if (!contentSearch || !projectId || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchProjectContents(projectId, query)
        .then((rows) => {
          setHits(rows);
          setIndex(0);
        })
        .catch(() => setHits([]));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [contentSearch, projectId, query]);

  function pick(hit: ContentHit) {
    mentionFile(hit.path);
    openInspector("files");
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
                setIndex((current) => Math.min(hits.length - 1, current + 1));
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
          {query.trim().length >= 2 && hits.length === 0 && <div className="sidebar-empty">No matches</div>}
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
