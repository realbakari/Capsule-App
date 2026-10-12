import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@capsule/shared";
import { SearchIcon, XIcon } from "../shell/icons";

/** Matches in the conversation, in order, as message ids. */
export function findInMessages(messages: readonly ChatMessage[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return messages.filter((message) => message.content.toLowerCase().includes(needle)).map((message) => message.id);
}

/** ⌘F for the conversation: a bar that counts matches and walks them. */
export function ThreadFind({ messages, onLocate, onClose }: {
  messages: readonly ChatMessage[];
  onLocate: (messageId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => findInMessages(messages, query), [messages, query]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setIndex(0); }, [query]);
  const current = matches[Math.min(index, Math.max(0, matches.length - 1))];
  useEffect(() => { if (current) onLocate(current); }, [current, onLocate]);
  const step = (delta: number) => {
    if (matches.length === 0) return;
    setIndex((value) => (value + delta + matches.length) % matches.length);
  };
  return (
    <div className="thread-find" role="search" aria-label="Find in conversation">
      <SearchIcon size={13} />
      <input
        ref={input}
        type="search"
        value={query}
        placeholder="Find in conversation"
        aria-label="Find in conversation"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
        }}
      />
      <span className="thread-find-count" aria-live="polite">{query.trim() ? (matches.length ? `${Math.min(index, matches.length - 1) + 1} of ${matches.length}` : "No matches") : ""}</span>
      <button type="button" className="chip" disabled={matches.length === 0} onClick={() => step(-1)} aria-label="Previous match">Previous</button>
      <button type="button" className="chip" disabled={matches.length === 0} onClick={() => step(1)} aria-label="Next match">Next</button>
      <button type="button" className="icon-btn" aria-label="Close find" onClick={onClose}><XIcon size={12} /></button>
    </div>
  );
}
