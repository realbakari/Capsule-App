import { useEffect, useMemo, useRef, useState } from "react";
import { promptIndex, type ChatMessage } from "@capsule/shared";
import "./prompt-jump.css";

/**
 * A searchable list of this thread's prompts, opened from the shortcut or the
 * palette; Enter scrolls to the chosen turn. The turn minimap is the visible
 * way to move between prompts, so this has no button of its own.
 */
export function PromptJump({ messages, open, hasOlder, loadingOlder, onLoadOlder, onOpenChange, onLocate }: {
  messages: readonly ChatMessage[];
  open: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onOpenChange: (open: boolean) => void;
  onLocate: (messageId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const entries = useMemo(() => promptIndex(messages, query), [messages, query]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (!open) { setQuery(""); return; }
    input.current?.focus();
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onOpenChange(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, onOpenChange]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  if (!open) return null;
  const choose = (messageId: string | undefined) => {
    if (!messageId) return;
    onOpenChange(false);
    onLocate(messageId);
  };
  return <div className="prompt-jump" ref={root}>
    <div className="prompt-jump-panel" role="dialog" aria-label="Jump to a prompt">
      <input ref={input} type="search" value={query} placeholder="Filter prompts" aria-label="Filter prompts"
        aria-controls="prompt-jump-list" aria-activedescendant={entries[active] ? `prompt-jump-${entries[active].messageId}` : undefined}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (entries.length) setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length);
          }
          if (event.key === "Enter") { event.preventDefault(); choose(entries[active]?.messageId); }
          if (event.key === "Escape") { event.preventDefault(); onOpenChange(false); }
        }} />
      {entries.length === 0
        ? <p className="prompt-jump-empty" role="status">{query.trim() ? "No prompt matches." : "No prompts loaded yet."}</p>
        : <ul id="prompt-jump-list" ref={list} role="listbox" aria-label="Prompts">{entries.map((entry, index) =>
          <li key={entry.messageId} id={`prompt-jump-${entry.messageId}`} role="option" aria-selected={index === active} data-index={index}
            onPointerMove={() => setActive(index)} onClick={() => choose(entry.messageId)}>
            <span className="prompt-jump-number">{entry.number}</span>
            <span className="prompt-jump-text" title={entry.text}>{entry.text}</span>
          </li>)}</ul>}
      {hasOlder && <button type="button" className="ghost prompt-jump-older" disabled={loadingOlder} onClick={onLoadOlder}>
        {loadingOlder ? "Loading…" : "Load earlier prompts"}
      </button>}
    </div>
  </div>;
}
