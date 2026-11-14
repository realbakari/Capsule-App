import { useEffect, useRef, useState } from "react";
import type { WebviewTag } from "electron";
import { findSummary } from "../../lib/browser-find";
import { ChevronDownIcon, XIcon } from "./icons";
import "./browser-find.css";

type FoundInPage = Event & { result: { requestId: number; activeMatchOrdinal: number; matches: number; finalUpdate: boolean } };

/**
 * Find on the page in the browser pane. Enter goes to the next match, ⇧Enter
 * to the previous; Escape closes and clears the highlight.
 */
export function BrowserFindBar({ view, onClose }: { view: WebviewTag | null; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ activeMatchOrdinal: number; matches: number }>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  useEffect(() => {
    if (!view) return;
    const found = (event: Event) => {
      const { activeMatchOrdinal, matches } = (event as FoundInPage).result;
      setResult({ activeMatchOrdinal, matches });
    };
    view.addEventListener("found-in-page", found);
    return () => {
      view.removeEventListener("found-in-page", found);
      try { view.stopFindInPage("clearSelection"); } catch { /* The page may already be gone. */ }
    };
  }, [view]);

  const search = (text: string, forward = true, findNext = false) => {
    if (!view) return;
    if (!text.trim()) { view.stopFindInPage("clearSelection"); setResult(undefined); return; }
    view.findInPage(text, { forward, findNext });
  };

  return (
    <div className="browser-find" role="search" aria-label="Find on page">
      <input
        ref={input}
        type="search"
        placeholder="Find on page"
        aria-label="Find on page"
        value={query}
        onChange={(event) => { setQuery(event.target.value); search(event.target.value); }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); search(query, !event.shiftKey, true); }
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
        }}
      />
      <span className="browser-find-count" aria-live="polite">{findSummary(result, query)}</span>
      <button type="button" className="icon-btn" aria-label="Previous match" title="Previous match (⇧↵)" disabled={!query.trim()} onClick={() => search(query, false, true)}>
        <span className="rotate-180" aria-hidden><ChevronDownIcon size={13} /></span>
      </button>
      <button type="button" className="icon-btn" aria-label="Next match" title="Next match (↵)" disabled={!query.trim()} onClick={() => search(query, true, true)}>
        <ChevronDownIcon size={13} />
      </button>
      <button type="button" className="icon-btn" aria-label="Close find" title="Close (Esc)" onClick={onClose}><XIcon size={12} /></button>
    </div>
  );
}
