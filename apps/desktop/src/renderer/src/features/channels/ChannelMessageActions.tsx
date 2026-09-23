import { useEffect, useRef, useState } from "react";
import type { ChannelMessage, ChannelReaction } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { CopyIcon, MessageSquareIcon, SmilePlusIcon, XIcon } from "../shell/icons";

const reactionCache = new Map<string, ChannelReaction[]>();
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀"];

/** Fetch on explicit interaction, never one subprocess per post on render. */
export function ChannelMessageActions({ message, reply, author }: { message: ChannelMessage; reply?: () => void; author: string }) {
  const { api } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [reactions, setReactions] = useState<ChannelReaction[] | undefined>(() => reactionCache.get(message.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
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
    inFlight.current = true; setBusy(true); setError(undefined);
    let accepted = false;
    try {
      if (action) {
        await api.reactToChannelMessage(message.id, action.emoji, action.kind); accepted = true;
        if (mounted.current) setReactions(undefined);
      }
      const next = await api.channelReactions(message.id);
      reactionCache.set(message.id, next);
      if (mounted.current) setReactions(next);
    } catch (reason) { if (mounted.current) setError(`${accepted ? "Change accepted, but counts could not be refreshed. " : ""}${formatUserError(reason)}`); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  function close() { setOpen(false); trigger.current?.focus(); }
  if (!api.isDesktop) return null;
  const extras = reactions?.filter((reaction) => !QUICK_REACTIONS.includes(reaction.emoji)) ?? [];
  return <>
    <div className={`channel-message-actions${open ? " open" : ""}`} aria-label="Message actions">
      <button ref={trigger} className="icon-btn" aria-label="Reactions" title="React" aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) void perform(); }}><SmilePlusIcon size={15} /></button>
      {reply && <button className="icon-btn" aria-label={`Reply to ${author} in thread`} title="Reply in thread" onClick={reply}><MessageSquareIcon size={15} /></button>}
      <button className="icon-btn" aria-label="Copy message" title="Copy message" onClick={() => { void navigator.clipboard.writeText(message.content).catch(() => { if (mounted.current) setError("Could not copy the message."); }); }}><CopyIcon size={15} /></button>
      {open && <div className="channel-reaction-panel" ref={panel} tabIndex={-1} role="group" aria-label="Message reactions" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
        <div className="channel-reaction-choices">
          {QUICK_REACTIONS.map((emoji) => {
            const current = reactions?.find((item) => item.emoji === emoji);
            return <div className="channel-reaction-entry" key={emoji}>
              <button type="button" disabled={busy || !reactions} aria-label={`${current?.mine ? "Remove" : "Add"} ${emoji} reaction`} aria-pressed={!!current?.mine} title={current?.mine ? "You reacted" : emoji} onClick={() => void perform({ emoji, kind: current?.mine ? "remove" : "add" })}>
                <span className="channel-reaction-glyph">{emoji}</span>
                {current ? <span className="channel-reaction-count">{current.count}</span> : null}
              </button>
              {current?.mine ? <span className="sr-only">You reacted</span> : null}
            </div>;
          })}
          {extras.map((reaction) => <div className="channel-reaction-entry" key={reaction.emoji}>
            <button type="button" disabled={busy} aria-label={`${reaction.mine ? "Remove" : "Add"} ${reaction.emoji} reaction`} aria-pressed={!!reaction.mine} onClick={() => void perform({ emoji: reaction.emoji, kind: reaction.mine ? "remove" : "add" })}>
              <span className="channel-reaction-glyph">{reaction.emoji}</span>
              <span className="channel-reaction-count">{reaction.count}</span>
            </button>
            {reaction.mine ? <span className="sr-only">You reacted</span> : null}
          </div>)}
        </div>
        {!reactions && !error && <p className="sr-only" role="status">Loading reactions…</p>}
        <button type="button" className="icon-btn channel-reaction-close" aria-label="Close reactions" onClick={close}><XIcon size={13} /></button>
      </div>}
    </div>
    {error && <p className="channel-action-notice channels-error" role="alert">{error}</p>}
    {!!reactions?.length && <div className="channel-reaction-counts">{reactions.map((reaction) => <button key={reaction.emoji} type="button" className={reaction.mine ? "mine" : ""} aria-pressed={!!reaction.mine} aria-label={`${reaction.emoji}, ${reaction.count} reactions`} title={reaction.mine ? "You reacted" : `${reaction.count}`} disabled={busy} onClick={() => void perform({ emoji: reaction.emoji, kind: reaction.mine ? "remove" : "add" })}><span>{reaction.emoji}</span><span>{reaction.count}</span></button>)}</div>}
  </>;
}
