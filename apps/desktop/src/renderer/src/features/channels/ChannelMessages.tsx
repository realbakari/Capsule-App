import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChannelMember, ChannelMessage, SharedChannel } from "@capsule/shared";
import { MarkdownBody } from "../conversation/MarkdownBody";
import { ArrowUpIcon, ChevronDownIcon, XIcon } from "../shell/icons";
import { shouldGroupChannelPosts } from "../../lib/channel-prefs";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { ChannelMessageActions } from "./ChannelMessageActions";
import { editMentions, mentionLabel, mentionQuery, mentionedText } from "./mentions";
import { ChannelDrafts } from "./channel-drafts";
import { ChannelProfile } from "./ChannelProfile";
import { ChannelComposerTools } from "./ChannelComposerTools";

export { ChannelDrafts } from "./channel-drafts";
type Api = typeof window.capsule;

const avatarBytes = new Map<string, string>();
const avatarLoads = new Map<string, Promise<string | undefined>>();
const avatarListeners = new Set<() => void>();
const subscribeAvatars = (listener: () => void) => { avatarListeners.add(listener); return () => { avatarListeners.delete(listener); }; };

function rememberAvatar(picture: string, data: string | undefined): string | undefined {
  if (!data || !/^data:image\/(png|jpeg|gif|webp);base64,/.test(data)) return;
  avatarBytes.set(picture, data);
  if (avatarBytes.size > 200) avatarBytes.delete(avatarBytes.keys().next().value!);
  for (const listener of avatarListeners) listener();
  return data;
}

function loadAvatar(api: Api, identity: string, picture: string): Promise<string | undefined> {
  const ready = avatarBytes.get(picture);
  if (ready) return Promise.resolve(ready);
  const existing = avatarLoads.get(picture);
  if (existing) return existing;
  const load = api.channelAvatar(identity).then((data) => rememberAvatar(picture, data), () => undefined).finally(() => {
    if (avatarLoads.get(picture) === load) avatarLoads.delete(picture);
  });
  avatarLoads.set(picture, load);
  return load;
}

export function warmChannelAvatars(api: Api, members: ChannelMember[]) {
  if (!api.isDesktop) return;
  for (const member of members) if (member.picture) void loadAvatar(api, member.pubkey, member.picture);
}

export function ChannelAvatar({ member, identity }: { member?: ChannelMember; identity: string }) {
  const { api } = useWorkspace();
  const picture = member?.picture;
  const data = useSyncExternalStore(subscribeAvatars, () => picture ? avatarBytes.get(picture) : undefined, () => undefined);
  const [failed, setFailed] = useState<string>();
  useEffect(() => {
    if (!api.isDesktop || !picture) return;
    void loadAvatar(api, identity, picture);
    // Retry transient failures; one shared load updates every mounted surface.
    const retry = window.setInterval(() => { if (!avatarBytes.has(picture)) void loadAvatar(api, identity, picture); }, 65_000);
    return () => window.clearInterval(retry);
  }, [api, identity, picture]);
  const initials = (member?.name ?? identity.slice(0, 2)).split(/\s+/).slice(0, 2).map((part) => [...part][0]).join("").toUpperCase();
  const emoji = member?.emojiAvatar;
  return <span className={`channel-avatar${member?.role === "bot" ? " agent" : " person"}${emoji ? " emoji" : ""}`} aria-hidden="true" style={emoji ? { backgroundColor: emoji.color } : undefined}>
    {emoji ? <span>{emoji.emoji}</span> : initials}
    {!emoji && data && data !== failed ? <img src={data} alt="" onError={() => setFailed(data)} /> : null}
  </span>;
}

export function MemberStack({ members }: { members: ChannelMember[] }) {
  const visible = members.slice(0, 3);
  if (!visible.length) return null;
  return (
    <span className="channel-reply-avatars" aria-hidden="true">
      {visible.map((member) => (
        <ChannelAvatar key={member.pubkey} identity={member.pubkey} member={member} />
      ))}
      {members.length > 3 ? <span className="channel-avatar overflow">+{members.length - 3}</span> : null}
    </span>
  );
}

function ChannelPostView({ message, members, reply, replies, compact }: { message: ChannelMessage; members: ChannelMember[]; reply?: () => void; replies: ChannelMessage[]; compact?: boolean }) {
  const member = members.find((item) => item.pubkey === message.author);
  const time = new Date(message.createdAt * 1000);
  const stamp = time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const participants = [...new Set(replies.map((item) => item.author))].slice(0, 3);
  const latest = replies.reduce((value, item) => Math.max(value, item.createdAt), 0);
  return <article className={`channel-post${compact ? " compact" : ""}`}>
    {compact
      ? <span className="channel-compact-time" title={time.toLocaleString()}>{stamp}</span>
      : member ? <ChannelProfile member={member} avatar={<ChannelAvatar member={member} identity={message.author} />}><ChannelAvatar member={member} identity={message.author} /></ChannelProfile> : <ChannelAvatar identity={message.author} />}
    <div className="channel-post-content">
      {compact ? null : <header>{member ? <ChannelProfile member={member} avatar={<ChannelAvatar member={member} identity={member.pubkey} />}><strong>{member.name}</strong></ChannelProfile> : <strong title={message.author}>{`${message.author.slice(0, 12)}…`}</strong>}
        {member?.role === "bot" && <span className="channel-agent-label">Agent</span>}
        <time dateTime={time.toISOString()} title={time.toLocaleString()}>{stamp}</time>
      </header>}
      <MarkdownBody content={message.content} renderText={(text) => mentionedText(text, members, message.mentions ?? []).map((part, index) => part.member ? <ChannelProfile key={index} className="channel-inline-mention" member={part.member} avatar={<ChannelAvatar member={part.member} identity={part.member.pubkey} />}><ChannelAvatar member={part.member} identity={part.member.pubkey} />{part.text}</ChannelProfile> : part.text)} />
      {reply && replies.length > 0 && <button className="channel-replies" onClick={reply} title="Replies in the loaded recent windows; not the complete history"><span className="channel-reply-avatars">{participants.map((identity) => <ChannelAvatar key={identity} identity={identity} member={members.find((item) => item.pubkey === identity)} />)}</span><strong>{replies.length} {replies.length === 1 ? "reply" : "replies"}</strong><span>Last reply {new Date(latest * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></button>}
      <ChannelMessageActions message={message} reply={reply} author={member?.name ?? "message"} />
    </div>
  </article>;
}

/** Skip a placeholder that would only flash before a fast response. */
export function usePendingReveal(pending: boolean, delay = 280) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!pending) { setVisible(false); return; }
    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [pending, delay]);
  return pending && visible;
}

const SKEL_WIDTHS = ["88%", "64%", "76%", "52%"];

/** Quiet stand-in for the transcript so the room does not flash a blank composer. */
export function ChannelLoadingFeed({ label = "Loading messages" }: { label?: string }) {
  return <div className="channel-feed channel-loading" role="status" aria-busy="true" aria-label={label}>
    <span className="sr-only">{label}</span>
    {SKEL_WIDTHS.map((width, index) => <div className="channel-skel-row" key={width}>
      <span className="channel-skel-avatar" />
      <span className="channel-skel-copy">
        <span className="channel-skel-line name" />
        <span className="channel-skel-line" style={{ width }} />
        {index === 0 ? <span className="channel-skel-line" style={{ width: "42%" }} /> : null}
      </span>
    </div>)}
  </div>;
}

/** Keep the reader's place on polling; follow only when already near the end. */
export function ChannelFeed({ messages, members, loaded = true, reply, empty, intro, threadMessages = [], lastRead, filter, onCaughtUp }: {
  messages: ChannelMessage[]; members: ChannelMember[]; loaded?: boolean;
  threadMessages?: ChannelMessage[];
  lastRead?: number;
  filter?: string;
  onCaughtUp?: () => void;
  reply?: (message: ChannelMessage) => void; empty?: React.ReactNode; intro?: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const caughtUp = useRef(onCaughtUp);
  caughtUp.current = onCaughtUp;
  const newestId = messages.at(-1)?.id;
  const needle = filter?.trim().toLowerCase();
  const visible = (reply ? messages.filter((message) => !message.rootId || !messages.some((other) => other.id === message.rootId)) : messages)
    .filter((message) => !needle || message.content.toLowerCase().includes(needle));
  const summaryMessages = [...new Map([...messages, ...threadMessages].map((message) => [message.id, message])).values()];
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && follow.current) {
      element.scrollTop = element.scrollHeight;
      caughtUp.current?.();
    }
  }, [newestId, loaded]);
  const showPlaceholder = usePendingReveal(!loaded);
  if (!loaded) return <div className="channel-feed-wrap" aria-busy="true">{showPlaceholder ? <ChannelLoadingFeed /> : null}</div>;
  return <div className="channel-feed-wrap">
    <div className="channel-feed" ref={scroller} onScroll={() => {
      const element = scroller.current!;
      follow.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48;
      setAway(!follow.current);
    }} aria-label="Channel messages" tabIndex={0}>
      {!needle ? intro : null}
      {!visible.length ? needle ? <p className="channels-hint">No matching messages in the loaded history.</p> : empty : null}
      {visible.map((message, index) => {
        const date = new Date(message.createdAt * 1000);
        const previous = visible[index - 1];
        const newDay = !previous || new Date(previous.createdAt * 1000).toDateString() !== date.toDateString();
        return <Fragment key={message.id}>
          {newDay && <div className="channel-day" aria-hidden="true"><span>{date.toLocaleDateString([], { month: "short", day: "numeric" })}</span></div>}
          {lastRead && previous && previous.createdAt <= lastRead && message.createdAt > lastRead && <div className="channel-unread-rule" role="status">New messages</div>}
          <ChannelPostView message={message} members={members} compact={shouldGroupChannelPosts(previous, message) && !newDay} reply={reply ? () => reply(message) : undefined} replies={summaryMessages.filter((item) => item.rootId === message.id && item.id !== message.id)} />
        </Fragment>;
      })}
    </div>
    {away && <button className="channel-latest" onClick={() => { const element = scroller.current; if (element) element.scrollTop = element.scrollHeight; follow.current = true; setAway(false); onCaughtUp?.(); }}><ChevronDownIcon size={14} />Latest messages</button>}
  </div>;
}

export function ChannelComposer({ api, channel, members, parentId, sent, drafts, hold = false }: {
  api: Api; channel: SharedChannel; members: ChannelMember[]; parentId?: string; sent: () => void; drafts: ChannelDrafts; hold?: boolean;
}) {
  const draftKey = `${channel.id}:${parentId ?? "main"}`;
  const { content, mentions, pending: busy, error } = useSyncExternalStore(drafts.subscribe, () => drafts.get(draftKey));
  const setContent = (value: string) => drafts.edit(draftKey, { content: value });
  const setMentions = (value: typeof mentions) => drafts.edit(draftKey, { mentions: value });
  const setError = (value?: string) => drafts.setError(draftKey, value);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<{ start: number; end: number }>();
  const [selected, setSelected] = useState(0);
  const picker = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!picking) return;
    const outside = (event: PointerEvent) => { if (!picker.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPicking(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [picking]);
  useEffect(() => {
    if (!picking) return;
    document.getElementById(`mention-${parentId ?? "main"}-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [parentId, picking, selected]);
  useLayoutEffect(() => {
    const field = textarea.current;
    // A held composer is only one pixel wide. Measuring its placeholder there
    // wraps every word and leaves an oversized empty editor after history loads.
    if (!field || hold) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 144)}px`;
  }, [content, hold]);
  function closePicker() { setPicking(false); textarea.current?.focus(); }
  const candidates = members.filter((member) => !mentions.some((item) => item.pubkey === member.pubkey) && member.name.toLowerCase().includes(query.toLowerCase())).slice(0, 20);
  const identityHint = (pubkey: string, name: string) => members.filter((member) => member.name.toLowerCase() === name.toLowerCase()).length > 1 ? ` · ${pubkey.slice(0, 8)}…${pubkey.slice(-4)}` : "";
  function choose(member: ChannelMember) {
    const field = textarea.current!;
    const start = range?.start ?? field.selectionStart, end = range?.end ?? field.selectionEnd;
    const label = mentionLabel(member);
    const prefix = start > 0 && !/\s/.test(content[start - 1]!) ? " " : "";
    const next = content.slice(0, start) + prefix + label + " " + content.slice(end);
    if (next.length > 16000) { setError("There is not enough room for this mention."); return; }
    setMentions([...editMentions(content, next, mentions), { start: start + prefix.length, end: start + prefix.length + label.length, text: label, pubkey: member.pubkey }]);
    setContent(next); setPicking(false); setRange(undefined);
    requestAnimationFrame(() => { field.focus(); field.setSelectionRange(start + prefix.length + label.length + 1, start + prefix.length + label.length + 1); });
  }
  function updateQuery(field: HTMLTextAreaElement) {
    const match = mentionQuery(field.value, field.selectionStart);
    if (!match || field.selectionStart !== field.selectionEnd || mentions.length >= 20) { setPicking(false); return; }
    setRange({ start: match.start, end: field.selectionStart }); setQuery(match.query); setSelected(0); setPicking(true);
  }
  const canSend = !busy && !hold && channel.joined && !!content.trim();
  return <form className={`channel-composer${hold ? " is-holding" : ""}`} onSubmit={(event) => {
    event.preventDefault(); if (!canSend) return;
    setPicking(false);
    void drafts.send(draftKey, (draft) => api.postChannelMessage({ channelId: channel.id, content: draft.content, replyTo: parentId, mentions: [...new Set(draft.mentions.map((item) => item.pubkey))] }), formatUserError)
      .then((accepted) => { if (accepted && active.current) sent(); });
  }}>
    <label className="sr-only" htmlFor={`channel-draft-${parentId ?? "main"}`}>{parentId ? "Reply in thread" : `Message #${channel.name}`}</label>
    <textarea ref={textarea} id={`channel-draft-${parentId ?? "main"}`} value={content} onChange={(event) => { drafts.edit(draftKey, { mentions: editMentions(content, event.target.value, mentions), content: event.target.value }); if (!event.nativeEvent.isTrusted || !(event.nativeEvent as InputEvent).isComposing) updateQuery(event.currentTarget); }} disabled={busy || hold || !channel.joined} maxLength={16000} rows={1}
      aria-expanded={picking && !!range} aria-controls={picking ? `mention-list-${parentId ?? "main"}` : undefined} aria-activedescendant={picking && range && candidates[selected] ? `mention-${parentId ?? "main"}-${selected}` : undefined}
      onClick={(event) => updateQuery(event.currentTarget)} onCompositionEnd={(event) => updateQuery(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (picking && range) {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePicker(); return; }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => candidates.length ? (value + (event.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length : 0); return; }
          if ((event.key === "Enter" || event.key === "Tab") && candidates[selected] && !event.shiftKey) { event.preventDefault(); choose(candidates[selected]!); return; }
        }
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
      }}
      placeholder={hold ? "Loading messages…" : channel.joined ? (parentId ? "Reply in thread…" : `Message #${channel.name}`) : "Join this channel to send messages"} />
    {mentions.length > 0 && <div className="channel-mentions" aria-label="Selected mentions">{mentions.map((mention) => <button type="button" key={mention.pubkey} disabled={busy} onClick={() => { const next = content.slice(0, mention.start) + content.slice(mention.end); setMentions(editMentions(content, next, mentions)); setContent(next); textarea.current?.focus(); }} aria-label={`Remove mention ${mention.text.slice(1)}`}>
      <ChannelAvatar identity={mention.pubkey} member={members.find((member) => member.pubkey === mention.pubkey)} />{mention.text}{identityHint(mention.pubkey, members.find((member) => member.pubkey === mention.pubkey)?.name ?? "")}<XIcon size={12} />
    </button>)}</div>}
    {error && <p className="channels-error" role="alert">{error}</p>}
    <div className="channel-composer-tools">
      <button ref={trigger} type="button" className="channel-mention-trigger" aria-label="Mention a channel member" aria-expanded={picking} disabled={busy || hold || !channel.joined || mentions.length >= 20} onClick={() => { setRange(undefined); setSelected(0); setQuery(""); setPicking((value) => !value); }}><span aria-hidden="true">@</span><span>Mention</span></button>
      <span className="channel-send-hint">Enter to send · Shift Enter for a new line</span>
      <ChannelComposerTools textarea={textarea} content={content} disabled={busy || hold || !channel.joined} change={(next, intermediate) => {
        const nextMentions = intermediate === undefined ? editMentions(content, next, mentions) : editMentions(intermediate, next, editMentions(content, intermediate, mentions));
        drafts.edit(draftKey, { content: next, mentions: nextMentions }); setPicking(false);
      }} />
      <button className="channel-send" disabled={!canSend} aria-label={busy ? "Sending message" : "Send message"} title="Send message"><ArrowUpIcon size={18} /></button>
    </div>
    {picking && <div className="channel-mention-menu" ref={picker} role="region" aria-label="Choose a member" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePicker(); } }}>
      {!range && <input autoFocus type="search" aria-label="Search members" placeholder="Find a person or agent" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === "Enter") event.preventDefault(); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => candidates.length ? (value + (event.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length : 0); }
        if (event.key === "Enter" || event.key === "Tab") { if (event.key === "Enter" || candidates[selected]) event.preventDefault(); if (candidates[selected]) choose(candidates[selected]!); }
      }} />}
      <div id={`mention-list-${parentId ?? "main"}`} role="listbox" aria-label="Mention suggestions">{candidates.map((member, index) => <button type="button" role="option" aria-selected={index === selected} id={`mention-${parentId ?? "main"}-${index}`} key={member.pubkey} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSelected(index)} onClick={() => choose(member)}>
        <ChannelAvatar member={member} identity={member.pubkey} /><span className="channel-mention-copy"><strong>{member.name}</strong><small title={member.pubkey}>{member.role === "bot" ? "Agent" : "Member"}{identityHint(member.pubkey, member.name)}</small></span>
      </button>)}{!candidates.length && <p>No matching people or agents</p>}</div>
    </div>}
  </form>;
}
