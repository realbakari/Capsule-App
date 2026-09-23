import { useEffect, useRef, useState } from "react";
import type { ChannelMessage, ChannelReaction } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { CopyIcon, MessageSquareIcon, XIcon } from "../shell/icons";

/** Fetch on explicit interaction, never one subprocess per post on render. */
export function ChannelMessageActions({ message, reply, author }: { message: ChannelMessage; reply?: () => void; author: string }) {
  const { api } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [reactions, setReactions] = useState<ChannelReaction[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const close = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  async function perform(action?: { emoji: string; kind: "add" | "remove" }) {
    if (inFlight.current || !api.isDesktop) return;
    inFlight.current = true; setBusy(true); setError(undefined); setNotice("");
    let accepted = false;
    try {
      if (action) {
        await api.reactToChannelMessage(message.id, action.emoji, action.kind); accepted = true;
        if (mounted.current) { setReactions(undefined); setNotice(action.kind === "add" ? "Reaction added." : "Reaction removed."); }
      }
      const next = await api.channelReactions(message.id);
      if (mounted.current) setReactions(next);
    } catch (reason) { if (mounted.current) setError(`${accepted ? "Change accepted, but counts could not be refreshed. " : ""}${formatUserError(reason)}`); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  function close() { setOpen(false); trigger.current?.focus(); }
  if (!api.isDesktop) return null;
  return <>
    <div className="channel-message-actions" aria-label="Message actions">
      <button ref={trigger} className="icon-btn" aria-label="Reactions" title="Reactions" aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) void perform(); }}>☺</button>
      {reply && <button className="icon-btn" aria-label={`Reply to ${author} in thread`} title="Reply in thread" onClick={reply}><MessageSquareIcon size={16} /></button>}
      <button className="icon-btn" aria-label="Copy message" title="Copy message" onClick={() => { void navigator.clipboard.writeText(message.content).then(() => { if (mounted.current) setNotice("Message copied."); }, () => { if (mounted.current) setError("Could not copy the message."); }); }}><CopyIcon size={16} /></button>
    </div>
    {open && <div className="channel-reaction-panel" ref={panel} tabIndex={-1} role="group" aria-label="Message reactions" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <header><strong>Reactions</strong><button className="icon-btn" aria-label="Close reactions" onClick={close}><XIcon size={14} /></button></header>
      <div className="channel-reaction-choices">{["👍", "❤️", "😂", "🎉", "👀"].map((emoji) => { const current = reactions?.find((item) => item.emoji === emoji); return <button key={emoji} disabled={busy || !reactions} aria-label={`${current?.mine ? "Remove" : "Add"} ${emoji} reaction`} aria-pressed={!!current?.mine} onClick={() => void perform({ emoji, kind: current?.mine ? "remove" : "add" })}>{emoji}</button>; })}</div>
      {!reactions && !error && <p role="status">Loading reactions…</p>}
      {reactions?.map((reaction) => <div className="channel-reaction-entry" key={reaction.emoji}><span>{reaction.emoji} <strong>{reaction.count}</strong>{reaction.mine ? " · You reacted" : ""}</span>
        {reaction.mine !== false && <button className="ghost" disabled={busy} onClick={() => void perform({ emoji: reaction.emoji, kind: "remove" })}>Remove mine</button>}
      </div>)}
      {reactions?.length === 0 && <p>No reactions yet</p>}
      <button className="ghost" disabled={busy} onClick={() => void perform()}>Refresh reactions</button>
    </div>}
    {(notice || error) && <p className={`channel-action-notice ${error ? "channels-error" : ""}`} role={error ? "alert" : "status"}>{error ?? notice}</p>}
    {!open && !!reactions?.length && <div className="channel-reaction-counts">{reactions.map((reaction) => <button key={reaction.emoji} aria-label={`${reaction.emoji}, ${reaction.count} reactions`} onClick={() => { setOpen(true); void perform(); }}>{reaction.emoji} {reaction.count}</button>)}</div>}
  </>;
}
