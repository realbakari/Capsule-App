import { useEffect, useState } from "react";
import type { ContentHit } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";

export function ContentSearch() {
  const { contentSearch, setContentSearch, projectId, mentionFile, api, openInspector } = useWorkspace();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [hits, setHits] = useState<ContentHit[]>([]);

  useEffect(() => {
    if (!contentSearch || !projectId || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api.searchContents(projectId, query).then((rows: ContentHit[]) => {
        setHits(rows);
        setIndex(0);
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [api, contentSearch, projectId, query]);

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
  );
}
