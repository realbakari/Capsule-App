import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChannelMember, ChannelMessage, SharedChannel } from "@capsule/shared";
import { MarkdownBody } from "../conversation/MarkdownBody";
import { ArrowUpIcon, ChevronDownIcon, XIcon } from "../shell/icons";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { ChannelMessageActions } from "./ChannelMessageActions";
import { editMentions, mentionLabel, mentionQuery, mentionedText, type DraftMention } from "./mentions";

export type ChannelDrafts = Map<string, { content: string; mentions: DraftMention[] }>;
type Api = typeof window.capsule;

export function ChannelAvatar({ member, identity }: { member?: ChannelMember; identity: string }) {
  const { api } = useWorkspace();
  const [image, setImage] = useState<{ picture: string; data: string }>();
  useEffect(() => {
    let active = true;
    const picture = member?.picture;
    setImage(undefined);
    if (api.isDesktop && picture) void api.channelAvatar(identity).then((data) => {
      if (active && data && /^data:image\/(png|jpeg|gif|webp);base64,/.test(data)) setImage({ picture, data });
    }, () => {});
    return () => { active = false; };
  }, [api, identity, member?.picture]);
  const initials = (member?.name ?? identity.slice(0, 2)).split(/\s+/).slice(0, 2).map((part) => [...part][0]).join("").toUpperCase();
  return <span className="channel-avatar" aria-hidden="true">
    {image?.picture === member?.picture && image ? <img src={image.data} alt="" onError={() => setImage(undefined)} /> : initials}
  </span>;
}

function ChannelPostView({ message, members, reply, replies }: { message: ChannelMessage; members: ChannelMember[]; reply?: () => void; replies: ChannelMessage[] }) {
  const member = members.find((item) => item.pubkey === message.author);
  const time = new Date(message.createdAt * 1000);
  const participants = [...new Set(replies.map((item) => item.author))].slice(0, 3);
  const latest = replies.reduce((value, item) => Math.max(value, item.createdAt), 0);
  return <article className="channel-post">
    <ChannelAvatar member={member} identity={message.author} />
    <div className="channel-post-content">
      <header><strong title={message.author}>{member?.name ?? `${message.author.slice(0, 12)}…`}</strong>
        {member?.role === "bot" && <span className="channel-agent-label">Agent</span>}
        <time dateTime={time.toISOString()} title={time.toLocaleString()}>{time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
      </header>
      <MarkdownBody content={message.content} renderText={(text) => mentionedText(text, members, message.mentions ?? []).map((part, index) => part.member ? <span key={index} className="channel-inline-mention" title={`${part.member.role === "bot" ? "Agent · " : ""}${part.member.pubkey}`}>{part.text}</span> : part.text)} />
      {reply && replies.length > 0 && <button className="channel-replies" onClick={reply} title="Replies in the loaded recent windows; not the complete history"><span className="channel-reply-avatars">{participants.map((identity) => <ChannelAvatar key={identity} identity={identity} member={members.find((item) => item.pubkey === identity)} />)}</span><strong>{replies.length} {replies.length === 1 ? "reply" : "replies"}</strong><span>Last reply {new Date(latest * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></button>}
      <ChannelMessageActions message={message} reply={reply} author={member?.name ?? "message"} />
    </div>
  </article>;
}

/** Keep the reader's place on polling; follow only when already near the end. */
export function ChannelFeed({ messages, members, loaded = true, reply, empty, threadMessages = [] }: {
  messages: ChannelMessage[]; members: ChannelMember[]; loaded?: boolean;
  threadMessages?: ChannelMessage[];
  reply?: (message: ChannelMessage) => void; empty?: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const visible = reply ? messages.filter((message) => !message.rootId || !messages.some((other) => other.id === message.rootId)) : messages;
  const summaryMessages = [...new Map([...messages, ...threadMessages].map((message) => [message.id, message])).values()];
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [messages]);
  return <div className="channel-feed-wrap">
    <div className="channel-feed" ref={scroller} onScroll={() => {
      const element = scroller.current!;
      follow.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48;
      setAway(!follow.current);
    }} aria-label="Channel messages" tabIndex={0}>
      {!loaded ? <p className="channels-hint" role="status">Loading messages…</p> : !visible.length ? empty : null}
      {visible.map((message, index) => {
        const date = new Date(message.createdAt * 1000);
        const previous = visible[index - 1];
        const newDay = !previous || new Date(previous.createdAt * 1000).toDateString() !== date.toDateString();
        return <Fragment key={message.id}>
          {newDay && <div className="channel-day"><span>{date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}</span></div>}
          <ChannelPostView message={message} members={members} reply={reply ? () => reply(message) : undefined} replies={summaryMessages.filter((item) => item.rootId === message.id && item.id !== message.id)} />
        </Fragment>;
      })}
    </div>
    {away && <button className="channel-latest" onClick={() => { const element = scroller.current; if (element) element.scrollTop = element.scrollHeight; follow.current = true; setAway(false); }}><ChevronDownIcon size={14} />Latest messages</button>}
  </div>;
}

export function ChannelComposer({ api, channel, members, parentId, sent, drafts }: {
  api: Api; channel: SharedChannel; members: ChannelMember[]; parentId?: string; sent: () => void; drafts: ChannelDrafts;
}) {
  const draftKey = `${channel.id}:${parentId ?? "main"}`;
  const [content, setContent] = useState(() => drafts.get(draftKey)?.content ?? "");
  const [mentions, setMentions] = useState<DraftMention[]>(() => drafts.get(draftKey)?.mentions ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<{ start: number; end: number }>();
  const [selected, setSelected] = useState(0);
  const picker = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  useEffect(() => { drafts.set(draftKey, { content, mentions }); }, [content, mentions, drafts, draftKey]);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (field) { field.style.height = "auto"; field.style.height = `${Math.min(field.scrollHeight, 192)}px`; }
  }, [content]);
  useEffect(() => {
    if (!picking) return;
    const outside = (event: PointerEvent) => { if (!picker.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPicking(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [picking]);
  function closePicker() { setPicking(false); textarea.current?.focus(); }
  const candidates = members.filter((member) => !mentions.some((item) => item.pubkey === member.pubkey) && member.name.toLowerCase().includes(query.toLowerCase())).slice(0, 20);
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
  const canSend = !busy && channel.joined && !!content.trim();
  return <form className="channel-composer" onSubmit={(event) => {
    event.preventDefault(); if (inFlight.current || !canSend) return;
    inFlight.current = true; setBusy(true); setError(undefined); setPicking(false);
    void api.postChannelMessage({ channelId: channel.id, content, replyTo: parentId, mentions: [...new Set(mentions.map((item) => item.pubkey))] }).then(() => {
      drafts.delete(draftKey); setContent(""); setMentions([]); sent();
    }, (reason) => setError(formatUserError(reason))).finally(() => { inFlight.current = false; setBusy(false); });
  }}>
    <label className="sr-only" htmlFor={`channel-draft-${parentId ?? "main"}`}>{parentId ? "Reply in thread" : `Message #${channel.name}`}</label>
    <textarea ref={textarea} id={`channel-draft-${parentId ?? "main"}`} value={content} onChange={(event) => { setMentions(editMentions(content, event.target.value, mentions)); setContent(event.target.value); if (!event.nativeEvent.isTrusted || !(event.nativeEvent as InputEvent).isComposing) updateQuery(event.currentTarget); }} disabled={busy || !channel.joined} maxLength={16000} rows={2}
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
      placeholder={channel.joined ? (parentId ? "Reply in thread…" : `Message #${channel.name}`) : "Join this channel to send messages"} />
    {mentions.length > 0 && <div className="channel-mentions" aria-label="Selected mentions">{mentions.map((mention) => <button type="button" key={mention.pubkey} disabled={busy} onClick={() => { const next = content.slice(0, mention.start) + content.slice(mention.end); setMentions(editMentions(content, next, mentions)); setContent(next); textarea.current?.focus(); }} aria-label={`Remove mention ${mention.text.slice(1)}`}>
      {mention.text}<XIcon size={12} />
    </button>)}</div>}
    {error && <p className="channels-error" role="alert">{error}</p>}
    <div className="channel-composer-tools">
      <button ref={trigger} type="button" className="channel-mention-trigger" aria-label="Mention a channel member" aria-expanded={picking} disabled={busy || !channel.joined || mentions.length >= 20} onClick={() => { setRange(undefined); setSelected(0); setQuery(""); setPicking((value) => !value); }}><span aria-hidden="true">@</span><span>Mention</span></button>
      <span className="channel-send-hint">Enter to send · Shift Enter for a new line</span>
      <button className="channel-send" disabled={!canSend} aria-label={busy ? "Sending message" : "Send message"} title="Send message"><ArrowUpIcon size={18} /></button>
    </div>
    {picking && <div className="channel-mention-menu" ref={picker} role="region" aria-label="Choose a member" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePicker(); } }}>
      {!range && <input autoFocus type="search" aria-label="Search members" placeholder="Find a person or agent" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} />}
      <div id={`mention-list-${parentId ?? "main"}`} role="listbox" aria-label="Mention suggestions">{candidates.map((member, index) => <button type="button" role="option" aria-selected={index === selected} id={`mention-${parentId ?? "main"}-${index}`} key={member.pubkey} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(member)}>
        <ChannelAvatar member={member} identity={member.pubkey} /><span>{member.name}<small>{member.role === "bot" ? "Agent" : "Member"}</small></span>
      </button>)}{!candidates.length && <p>No matching members</p>}</div>
    </div>}
  </form>;
}
