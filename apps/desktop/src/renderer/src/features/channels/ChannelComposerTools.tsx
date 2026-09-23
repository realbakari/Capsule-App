import { useEffect, useRef, useState, type RefObject } from "react";
import { CHANNEL_FORMATS, formatChannelSelection, type ChannelFormat } from "./channel-format";
import { SmilePlusIcon, XIcon } from "../shell/icons";

const EMOJI = [
  ["👍", "thumbs up yes"], ["👎", "thumbs down no"], ["❤️", "heart love"], ["😆", "laugh smile"], ["😂", "joy laugh"], ["😊", "smile happy"],
  ["🎉", "party celebrate"], ["👀", "eyes look"], ["✅", "check done"], ["🚀", "rocket ship"], ["🙏", "thanks pray"], ["🤔", "thinking"],
  ["🔥", "fire"], ["💡", "idea light"], ["🐛", "bug"], ["🛠️", "tools fix"], ["💻", "computer code"], ["⚠️", "warning"],
] as const;
const labels: Record<ChannelFormat, string> = { Bold: "B", Italic: "I", Strikethrough: "S̶", "Inline code": "‹›", "Code block": "{ }", Link: "↗", "Bullet list": "• ≡", "Numbered list": "1. ≡", Quote: "❞" };

export function ChannelComposerTools({ textarea, content, disabled, change }: {
  textarea: RefObject<HTMLTextAreaElement | null>; content: string; disabled: boolean;
  change: (content: string, intermediate?: string) => void;
}) {
  const [formatting, setFormatting] = useState(false);
  const [emojis, setEmojis] = useState(false);
  const [query, setQuery] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!emojis) return;
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setEmojis(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [emojis]);
  function insert(kind: ChannelFormat | { emoji: string }) {
    const field = textarea.current;
    if (!field || disabled) return;
    const start = field.selectionStart, end = field.selectionEnd;
    const result = typeof kind === "string" ? formatChannelSelection(content, start, end, kind) : { content: content.slice(0, start) + kind.emoji + content.slice(end), start: start + kind.emoji.length, end: start + kind.emoji.length, before: undefined };
    if (result.content.length > 16000) return;
    change(result.content, result.before); setEmojis(false);
    requestAnimationFrame(() => { field.focus(); field.setSelectionRange(result.start, result.end); });
  }
  return <>
    <button ref={trigger} type="button" className="icon-btn" aria-label="Insert emoji" aria-expanded={emojis} disabled={disabled} onClick={() => { setQuery(""); setEmojis(!emojis); }}><SmilePlusIcon size={18} /></button>
    <button type="button" className="icon-btn channel-format-toggle" aria-label="Formatting options" aria-expanded={formatting} disabled={disabled} onClick={() => setFormatting(!formatting)}>Aa</button>
    {formatting && <div className="channel-format-bar" role="group" aria-label="Message formatting">
      {Object.keys(CHANNEL_FORMATS).map((name) => <button type="button" className="icon-btn" key={name} aria-label={name} title={name} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => insert(name as ChannelFormat)}>{labels[name as ChannelFormat]}</button>)}
      <button type="button" className="icon-btn" aria-label="Hide formatting" onClick={() => setFormatting(false)}><XIcon size={15} /></button>
    </div>}
    {emojis && <div ref={panel} className="channel-emoji-picker" role="region" aria-label="Choose emoji" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEmojis(false); trigger.current?.focus(); } }}>
      <input autoFocus type="search" aria-label="Search emoji" placeholder="Search emoji" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
      <div>{EMOJI.filter(([emoji, name]) => `${emoji} ${name}`.includes(query.toLowerCase())).map(([emoji, name]) => <button type="button" key={emoji} disabled={disabled} title={name} aria-label={`Insert ${emoji}`} onClick={() => insert({ emoji })}>{emoji}</button>)}</div>
      <small>Common emoji · You can also paste any emoji.</small>
    </div>}
  </>;
}
