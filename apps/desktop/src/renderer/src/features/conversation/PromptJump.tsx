import { useEffect, useMemo, useRef, useState } from "react";
import { promptIndex, type ChatMessage } from "@capsule/shared";
import { ListIcon } from "../shell/icons";
import "./prompt-jump.css";

/** A small list of this thread's prompts; Enter scrolls to the chosen turn. */
export function PromptJump({ messages, open, shortcut, hasOlder, loadingOlder, onLoadOlder, onOpenChange, onLocate }: {
  messages: readonly ChatMessage[];
  open: boolean;
  shortcut?: string;
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
  const promptCount = useMemo(() => messages.filter((message) => message.role === "user").length, [messages]);
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
  if (promptCount < 2 && !hasOlder) return null;
  const choose = (messageId: string | undefined) => {
    if (!messageId) return;
    onOpenChange(false);
    onLocate(messageId);
  };
  return <div className="prompt-jump" ref={root}>
    <button type="button" className="icon-btn prompt-jump-trigger" aria-label="Jump to a prompt" aria-expanded={open} aria-haspopup="dialog"
      title={`Jump to a prompt${shortcut ? ` (${shortcut})` : ""}`} onClick={() => onOpenChange(!open)}>
      <ListIcon size={14} />
    </button>
    {open && <div className="prompt-jump-panel" role="dialog" aria-label="Jump to a prompt">
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
    </div>}
  </div>;
}
