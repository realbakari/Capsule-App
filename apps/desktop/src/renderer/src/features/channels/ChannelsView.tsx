import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type ReactNode, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { ChannelMember, ChannelMessage, RelayConnectionStatus, SharedChannel } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import {
  channelIsUnread,
  clampThreadWidth,
  loadChannelPrefs,
  markChannelRead,
  markChannelUnread,
  recordChannelActivity,
  saveChannelPrefs,
  toggleMuted,
  toggleStarred,
  type ChannelPrefs,
} from "../../lib/channel-prefs";
import { ActionMenu } from "../shell/ActionMenu";
import type { ActionMenuItem } from "../../lib/action-menu";
import { PlusIcon, MessageSquareIcon, XIcon, SearchIcon, MoreHorizontalIcon, RefreshIcon, ChevronDownIcon, HashIcon, StarIcon, BellOffIcon, CopyIcon, LockIcon } from "../shell/icons";
import { ChannelAvatar, ChannelComposer, ChannelFeed, ChannelLoadingFeed, MemberStack, usePendingReveal, warmChannelAvatars, ChannelDrafts } from "./ChannelMessages";
import { ChannelDetails } from "./ChannelDetails";
import { ChannelProfile } from "./ChannelProfile";
import "./channels.css";

type Api = typeof window.capsule;
function Failure({ error }: { error?: string }) { return error ? <p className="channels-error" role="alert">{error}</p> : null; }

export function ChannelsView() {
  const { api } = useWorkspace();
  const [connection, setConnection] = useState<RelayConnectionStatus>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!api.isDesktop) return;
    let active = true;
    void api.relayStatus().then((status) => { if (active) setConnection(status); }, (reason) => { if (active) setError(formatUserError(reason)); });
    return () => { active = false; };
  }, [api, revision]);
  if (!api.isDesktop) return <section className="channels-setup"><h2>Shared channels</h2><p>Open Channels in the desktop app to connect your own relay identity. Paired previews do not inherit private channel access.</p></section>;
  return <section className="channels-view" aria-label="Shared channels">
    <Failure error={error} />
    {error && <button className="ghost" onClick={() => { setError(undefined); setRevision((value) => value + 1); }}>Retry connection status</button>}
    {!connection ? <p role="status">Checking connection…</p> : connection.connected
      ? <ConnectedChannels api={api} connection={connection} changed={setConnection} />
      : <RelaySetup key={connection.url ?? "new"} api={api} connection={connection} connected={setConnection} />}
  </section>;
}

function RelaySetup({ api, connection, connected }: { api: Api; connection: RelayConnectionStatus; connected: (status: RelayConnectionStatus) => void }) {
  const [url, setUrl] = useState(connection.url ?? "http://localhost:3000");
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(!!connection.canRemember);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const savedIdentity = connection.remembered && url === connection.url;
  return <form className="channels-setup" onSubmit={(event) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(undefined);
    const privateKey = key; setKey("");
    void api.connectRelay({ url, privateKey, remember }).then(connected, (reason) => setError(formatUserError(reason))).finally(() => setBusy(false));
  }}>
    <MessageSquareIcon size={28} /><h2>Bring your team into the workspace</h2>
    <p>Shared channels, replies, and coding-agent mentions on your self-hosted relay. Your local conversations stay separate.</p>
    <label>Relay URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} required disabled={busy} spellCheck={false} /></label>
    <label>Identity key<input type="password" value={key} onChange={(event) => setKey(event.target.value)} required={!savedIdentity} disabled={busy} autoComplete="off" placeholder={savedIdentity ? "Saved securely — leave blank to reuse" : "Hex or nsec key"} spellCheck={false} /></label>
    <label className="channel-remember"><input type="checkbox" checked={remember} disabled={busy || !connection.canRemember} onChange={(event) => setRemember(event.target.checked)} />Remember on this device</label>
    <p className="channels-hint">{connection.canRemember ? "Your relay address and identity key are encrypted using this device’s protected credential storage. Otherwise, new credentials last only for this app session." : "Protected credential storage is unavailable. New credentials can only be used for this app session."} Use a dedicated identity admitted by your relay administrator.</p>
    {connection.hasSaved && <p className="channels-hint">Disconnect keeps saved details. Forget connection removes them from this device.</p>}
    <Failure error={error ?? connection.warning} /><button className="primary" disabled={busy || (!key.trim() && !savedIdentity)}>{busy ? "Connecting…" : savedIdentity ? "Reconnect" : "Connect"}</button>
    {connection.hasSaved && <button type="button" className="ghost" disabled={busy} onClick={() => { setBusy(true); void api.forgetRelay().then(connected, (reason) => setError(formatUserError(reason))).finally(() => setBusy(false)); }}>Forget connection</button>}
    <details><summary>Before connecting</summary><p>Install the relay CLI (<code>buzz</code>) on this computer and make it available on PATH. Use HTTPS for a remote relay. Agent hosts and their repository permissions are configured separately; joining a channel never starts a local agent.</p></details>
  </form>;
}

function ConnectedChannels({ api, connection, changed }: { api: Api; connection: RelayConnectionStatus; changed: (status: RelayConnectionStatus) => void }) {
  const url = connection.url!;
  const [channels, setChannels] = useState<SharedChannel[]>([]);
  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState("");
  const [joinedOnly, setJoinedOnly] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [prefs, setPrefs] = useState<ChannelPrefs>(() => loadChannelPrefs());
  const [menu, setMenu] = useState<{ id: string; point: { x: number; y: number } }>();
  const drafts = useRef(new ChannelDrafts());
  const search = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const visible = useMemo(() => channels.filter((item) => (!joinedOnly || item.joined) && item.name.toLowerCase().includes(query.toLowerCase())), [channels, joinedOnly, query]);
  const starred = visible.filter((item) => prefs.starred.includes(item.id) && !prefs.muted.includes(item.id));
  const muted = visible.filter((item) => prefs.muted.includes(item.id));
  const rest = visible.filter((item) => !prefs.starred.includes(item.id) && !prefs.muted.includes(item.id));
  const ordered = [...starred, ...rest, ...muted];
  async function refresh() {
    try {
      const next = await api.listSharedChannels();
      if (!mounted.current) return;
      setChannels(next); setLoaded(true);
      setSelected((current) => next.some((item) => item.id === current) ? current : next.find((item) => item.joined)?.id);
    } catch (reason) {
      if (mounted.current) setLoaded(true);
      throw reason;
    }
  }
  async function perform(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError(undefined);
    try { await action(); } catch (reason) { if (mounted.current) setError(formatUserError(reason)); }
    finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    void perform(refresh);
    return () => { mounted.current = false; };
  }, [api]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const typing = event.target instanceof HTMLElement && Boolean(event.target.closest("input, textarea, select, [contenteditable]"));
      if (typing || ordered.length === 0) return;
      event.preventDefault();
      const index = Math.max(0, ordered.findIndex((item) => item.id === selected));
      const next = ordered[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) setSelected(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered, selected]);
  function channelItems(item: SharedChannel): ActionMenuItem[] {
    const starredChannel = prefs.starred.includes(item.id);
    const mutedChannel = prefs.muted.includes(item.id);
    return [
      { id: "star", label: starredChannel ? "Unstar" : "Star", icon: starredChannel ? "star-off" : "star" },
      { id: "mute", label: mutedChannel ? "Unmute" : "Mute", icon: mutedChannel ? "bell" : "bell-off" },
      { id: "unread", label: "Mark unread", icon: "refresh", separatorBefore: true },
      { id: "copy-name", label: "Copy name", icon: "copy", separatorBefore: true },
      { id: "copy-id", label: "Copy channel ID", icon: "copy" },
    ];
  }
  function runChannelAction(id: string, action: string) {
    const item = channels.find((channel) => channel.id === id);
    setMenu(undefined);
    if (!item) return;
    if (action === "star") setPrefs(toggleStarred(prefs, id));
    if (action === "mute") setPrefs(toggleMuted(prefs, id));
    if (action === "unread") setPrefs(markChannelUnread(prefs, id));
    if (action === "copy-name") void navigator.clipboard.writeText(item.name);
    if (action === "copy-id") void navigator.clipboard.writeText(item.id);
  }
  function renderChannelLink(item: SharedChannel) {
    const unread = channelIsUnread(prefs, item.id);
    return <button key={item.id} className={`channel-link ${selected === item.id ? "active" : ""}${unread ? " unread" : ""}${prefs.muted.includes(item.id) ? " muted" : ""}`} aria-current={selected === item.id ? "page" : undefined} onClick={() => setSelected(item.id)} onContextMenu={(event) => { event.preventDefault(); setMenu({ id: item.id, point: { x: event.clientX, y: event.clientY } }); }}>
      {prefs.starred.includes(item.id) ? <StarIcon size={13} /> : <HashIcon size={14} />}
      <span>{item.name}</span>
      {unread ? <i className="channel-unread-dot" aria-label="Unread" /> : !item.joined ? <small>Join</small> : prefs.muted.includes(item.id) ? <BellOffIcon size={12} /> : null}
    </button>;
  }
  const channel = channels.find((item) => item.id === selected);
  const showDirectoryPlaceholder = usePendingReveal(!loaded);
  return <>
    <Failure error={error ?? connection.warning} />
    <div className="channels-layout">
      <nav className="channel-directory" aria-label="Channel directory">
        <div className="channel-community"><span className="channel-community-mark"><MessageSquareIcon size={19} /></span><div><strong>Team workspace</strong><small title={url}>{new URL(url).hostname}</small></div>
          <details className="channel-connection-menu"><summary aria-label="Connection options"><MoreHorizontalIcon size={18} /></summary><div><p title={url}>{url}</p><p>{connection.remembered ? "Remembered securely on this device." : "This connection is not saved."}</p><p>Latest 100 channels and text messages. Messages refresh every 5 seconds.</p>
            {!connection.remembered && <button disabled={busy || !connection.canRemember} onClick={() => void perform(async () => changed(await api.rememberRelay()))}>Remember on this device</button>}
            {!connection.canRemember && <p>Protected credential storage is unavailable.</p>}
            <button disabled={busy} onClick={() => void perform(async () => changed(await api.disconnectRelay()))}>Disconnect</button>
            {connection.hasSaved && <button disabled={busy} onClick={() => void perform(async () => changed(await api.forgetRelay()))}>Forget connection</button>}
          </div></details>
        </div>
        <label className="channel-search"><SearchIcon size={15} /><input ref={search} type="search" aria-label="Search channels" placeholder="Find a channel" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="channel-directory-heading"><span>Channels</span><div><button className="icon-btn" title="Refresh channels" aria-label="Refresh channels" disabled={busy} onClick={() => void perform(refresh)}><RefreshIcon size={14} /></button><button className="icon-btn" title="Create channel" aria-label="Create channel" onClick={() => setCreating(true)}><PlusIcon size={16} /></button></div></div>
        <div className="channel-filters" aria-label="Filter channels"><button aria-pressed={!joinedOnly} onClick={() => setJoinedOnly(false)}>All channels</button><button aria-pressed={joinedOnly} onClick={() => setJoinedOnly(true)}>Joined</button></div>
        {creating && <ChannelDialog title="Create a channel" close={() => setCreating(false)}><NewChannel api={api} done={async (id) => { await refresh(); setSelected(id); setCreating(false); }} /></ChannelDialog>}
        <div className="channel-links" aria-busy={!loaded}>
        {!loaded ? (showDirectoryPlaceholder ? <ChannelListSkeleton /> : null) : !channels.length ? <p>No visible channels. Create one or ask your administrator for an invitation.</p> : null}
        {loaded && channels.length > 0 && visible.length === 0 && <p className="channels-hint">No matching channels.</p>}
        {starred.length > 0 && <p className="channel-section">Starred</p>}
        {starred.map(renderChannelLink)}
        {starred.length > 0 && <p className="channel-section">Channels</p>}
        {rest.map(renderChannelLink)}
        {muted.length > 0 && <p className="channel-section">Muted</p>}
        {muted.map(renderChannelLink)}
        </div>
        <button className="channel-browse" onClick={() => setBrowsing(true)}><SearchIcon size={14} />Browse channels</button>
      </nav>
      {!loaded ? (showDirectoryPlaceholder ? <ChannelRoomSkeleton /> : <section className="channel-room" aria-busy="true" />) : channel ? <ChannelRoom key={channel.id} api={api} channel={channel} drafts={drafts.current} prefs={prefs} setPrefs={setPrefs} changed={refresh} browse={() => setBrowsing(true)} create={() => setCreating(true)} /> : <div className="channel-empty"><MessageSquareIcon size={28} /><h3>A space for your team and agents</h3><p>Select a channel, or create a private channel to get started.</p></div>}
      {browsing && <ChannelDialog title="Browse channels" close={() => setBrowsing(false)}><ChannelBrowser channels={channels} select={(id) => { setSelected(id); setBrowsing(false); }} create={() => { setBrowsing(false); setCreating(true); }} /></ChannelDialog>}
      {menu && channels.some((item) => item.id === menu.id) && <ActionMenu items={channelItems(channels.find((item) => item.id === menu.id)!)} point={menu.point} onClose={() => setMenu(undefined)} onSelect={(action) => runChannelAction(menu.id, action)} />}
    </div>
  </>;
}

function ChannelBrowser({ channels, select, create }: { channels: SharedChannel[]; select: (id: string) => void; create: () => void }) {
  const [query, setQuery] = useState("");
  const [joined, setJoined] = useState(false);
  const matches = channels.filter((channel) => (!joined || channel.joined) && `${channel.name} ${channel.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="channel-browser">
    <label className="channel-search"><SearchIcon size={18} /><input autoFocus type="search" aria-label="Find channels" placeholder="Search channels and descriptions" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="channel-browser-tabs"><button aria-pressed={!joined} onClick={() => setJoined(false)}>All channels</button><button aria-pressed={joined} onClick={() => setJoined(true)}>Joined</button></div>
    <button className="channel-browser-create" onClick={create}><PlusIcon size={20} />Create a new channel</button>
    <div className="channel-browser-results">{matches.map((channel) => <button key={channel.id} onClick={() => select(channel.id)}><strong><HashIcon size={17} />{channel.name}</strong><span>{channel.description || "No description"}</span><small>{channel.joined ? "Joined" : "Open channel to join"}</small></button>)}{!matches.length && <p className="channels-hint">No matching channels.</p>}</div>
    <p className="channels-hint">Searches the channels returned by your relay, up to 100.</p>
  </div>;
}

function ChannelDialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element.close(); queueMicrotask(() => { if (previous?.isConnected) previous.focus(); }); };
  }, []);
  return createPortal(<dialog className="channel-dialog" ref={dialog} aria-label={title} onCancel={(event) => { event.preventDefault(); close(); }}>
    <header className="channels-toolbar"><h2>{title}</h2><button className="icon-btn" aria-label="Close dialog" onClick={close}><XIcon size={18} /></button></header>{children}
  </dialog>, document.body);
}

function NewChannel({ api, done }: { api: Api; done: (id: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "open">("private");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string>();
  return <form className="channel-form" onSubmit={(event) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(undefined);
    const action = created ? Promise.resolve(created) : api.createSharedChannel({ name, description, visibility }).then((id) => { setCreated(id); return id; });
    void action.then(done).catch((reason) => setError(formatUserError(reason))).finally(() => setBusy(false));
  }}>
    <p className="channels-hint">Give a project, discussion, or group of agents a shared place to work.</p>
    <label>Name<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} required /></label>
    <label>Description<input value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} /></label>
    <fieldset className="channel-access">
      <legend>Access</legend>
      <button type="button" aria-pressed={visibility === "private"} onClick={() => setVisibility("private")}><LockIcon size={15} /><span><strong>Private</strong><small>Invited members only</small></span></button>
      <button type="button" aria-pressed={visibility === "open"} onClick={() => setVisibility("open")}><HashIcon size={15} /><span><strong>Open</strong><small>Anyone on the relay can join</small></span></button>
    </fieldset>
    <Failure error={error} /><button className="primary" disabled={busy || !name.trim()}>{busy ? "Working…" : created ? "Open created channel" : "Create"}</button>
  </form>;
}

function ChannelRoom({ api, channel, changed, drafts, prefs, setPrefs, browse, create }: { api: Api; channel: SharedChannel; changed: () => Promise<void>; drafts: ChannelDrafts; prefs: ChannelPrefs; setPrefs: Dispatch<SetStateAction<ChannelPrefs>>; browse: () => void; create: () => void }) {
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [membersReady, setMembersReady] = useState(false);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [parent, setParent] = useState<ChannelMessage>();
  const [error, setError] = useState<string>();
  const [memberError, setMemberError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const [invite, setInvite] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Poll only while this room is visible, never queue overlapping requests.
  const [settings, setSettings] = useState(false);
  const [threadMessages, setThreadMessages] = useState<ChannelMessage[]>([]);
  const [messageQuery, setMessageQuery] = useState("");
  const [threadWidth, setThreadWidth] = useState(prefs.threadWidth);
  const threadLoaded = useCallback((messages: ChannelMessage[]) => setThreadMessages(messages), []);
  const latest = messages.reduce((value, message) => Math.max(value, message.createdAt), 0);
  const showComposerPlaceholder = usePendingReveal(!loaded);
  function catchUp() {
    if (latest > 0) setPrefs((current) => markChannelRead(current, channel.id, latest));
  }
  // Re-fetching the bounded window also drops messages removed from the relay.
  useEffect(() => {
    let active = true; let initial = true; let timer: ReturnType<typeof setTimeout>;
    async function load() {
      if (!active) return;
      if (!initial && document.hidden) { timer = setTimeout(load, 5000); return; }
      initial = false;
      try {
        const next = await api.channelMessages(channel.id);
        if (active) {
          setMessages(next); setLoaded(true); setError(undefined);
          const newest = next.reduce((value, message) => Math.max(value, message.createdAt), 0);
          if (newest > 0) setPrefs((current) => recordChannelActivity(current, channel.id, newest));
        }
      } catch (reason) { if (active) { setLoaded(true); setError(formatUserError(reason)); } }
      finally { if (active) timer = setTimeout(load, 5000); }
    }
    void load();
    void api.channelMembers(channel.id).then((next) => {
      if (!active) return;
      warmChannelAvatars(api, next);
      setMembers(next); setMembersReady(true); setMemberError(undefined);
    }, (reason) => { if (active) { setMembers([]); setMembersReady(true); setMemberError(formatUserError(reason)); } });
    return () => { active = false; clearTimeout(timer); };
  }, [api, channel.id, refreshCount]);
  function startThreadResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const origin = event.clientX;
    const start = threadWidth;
    const move = (next: PointerEvent) => {
      const width = clampThreadWidth(start + (origin - next.clientX));
      setThreadWidth(width);
      setPrefs((current) => saveChannelPrefs({ ...current, threadWidth: width }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  return <div className={`channel-room ${parent || invite || settings ? "has-thread" : ""}`}>
    <section className="channel-main" aria-label={`Channel ${channel.name}`}>
      <header className="channel-room-header"><div><h3><HashIcon size={16} />{channel.name}<button className="icon-btn" title="Copy channel name" aria-label="Copy channel name" onClick={() => void navigator.clipboard.writeText(channel.name)}><CopyIcon size={13} /></button></h3>{channel.description && <p>{channel.description}</p>}</div>
        <div className="channel-actions">
          <label className="channel-message-search"><SearchIcon size={13} /><input type="search" aria-label="Search loaded messages" placeholder="Search loaded messages" value={messageQuery} onChange={(event) => setMessageQuery(event.target.value)} /></label>
          <button className="ghost channel-members-btn" onClick={() => { setParent(undefined); setSettings(false); setInvite((value) => !value); }} disabled={!channel.joined || !membersReady} aria-expanded={invite}>Members ({membersReady ? members.length : "…"})<MemberStack members={members} /></button>{!channel.joined && <button className="ghost" disabled={busy} onClick={() => {
          setBusy(true); setError(undefined);
          void api.channelMembership(channel.id, channel.joined ? "leave" : "join").then(changed).catch((reason) => setError(formatUserError(reason))).finally(() => setBusy(false));
        }}>Join</button>}<button className="icon-btn" aria-label="Channel settings" title="Channel settings" aria-expanded={settings} onClick={() => { setInvite(false); setParent(undefined); setSettings((value) => !value); }}><MoreHorizontalIcon size={18} /></button></div>
      </header>
      <Failure error={error} />
      <Failure error={memberError} />
      <ChannelFeed messages={messages} members={members} threadMessages={threadMessages} loaded={loaded} filter={messageQuery} lastRead={prefs.lastRead[channel.id]} onCaughtUp={catchUp} reply={(message) => { setInvite(false); setSettings(false); setThreadMessages([]); setParent(message.rootId ? { ...message, id: message.rootId } : message); }} intro={!error && <div className="channel-welcome"><span className="channel-welcome-mark" aria-hidden="true"><HashIcon size={28} /></span><h2>#{channel.name}</h2>{channel.description ? <p>{channel.description}</p> : null}<div className="channel-welcome-actions"><button onClick={browse}><SearchIcon size={20} />Browse channels</button><button onClick={create}><PlusIcon size={20} />Create a channel</button><button disabled={!channel.joined} onClick={() => { setSettings(false); setInvite(true); }}><MessageSquareIcon size={20} />People and agents</button></div></div>} />
      {showComposerPlaceholder ? <ComposerSkeleton /> : null}
      <ChannelComposer api={api} channel={channel} members={members} drafts={drafts} hold={!loaded} sent={() => { catchUp(); setRefreshCount((value) => value + 1); }} />
    </section>
    {parent && <ChannelThread key={parent.id} api={api} channel={channel} members={members} drafts={drafts} parent={parent} loadedMessages={threadLoaded} width={threadWidth} resize={startThreadResize} close={() => setParent(undefined)} />}
    {invite && <MemberDrawer close={() => setInvite(false)}><MemberPanel api={api} channelId={channel.id} members={members} changed={() => setRefreshCount((value) => value + 1)} /></MemberDrawer>}
    {settings && <ChannelDetails api={api} channel={channel} members={members} changed={changed} close={() => setSettings(false)} showMembers={() => { setSettings(false); setInvite(true); }} />}
  </div>;
}

function ChannelListSkeleton() {
  return <div className="channel-skel-list" role="status" aria-label="Loading channels">
    <span className="sr-only">Loading channels</span>
    {["72%", "54%", "64%", "46%", "58%"].map((width) => <div className="channel-skel-link" key={width}><span className="channel-skel-hash" /><span className="channel-skel-line" style={{ width }} /></div>)}
  </div>;
}

function ComposerSkeleton() {
  return <div className="channel-composer-skel" aria-hidden="true"><span className="channel-skel-line" /><span className="channel-skel-tools"><span /><span /><span /></span></div>;
}

function ChannelRoomSkeleton() {
  return <section className="channel-room channel-room-skel" aria-busy="true" aria-label="Loading channel">
    <header className="channel-room-header"><span className="channel-skel-line name" /></header>
    <ChannelLoadingFeed label="Loading channel" />
    <ComposerSkeleton />
  </section>;
}

function MemberDrawer({ close, children }: { close: () => void; children: ReactNode }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; button.current?.focus(); return () => previous?.focus(); }, []);
  return <aside className="channel-thread channel-member-drawer" aria-label="People and agents"><header className="channel-room-header"><h3>People and agents</h3><button ref={button} className="icon-btn" aria-label="Close members" onClick={close}><XIcon size={16} /></button></header><div className="channel-member-content">{children}</div></aside>;
}

function ChannelThread({ api, channel, members, parent, close, drafts, loadedMessages, width, resize }: { api: Api; channel: SharedChannel; members: ChannelMember[]; parent: ChannelMessage; close: () => void; drafts: ChannelDrafts; loadedMessages: (messages: ChannelMessage[]) => void; width: number; resize: (event: ReactPointerEvent<HTMLDivElement>) => void }) {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const showComposerPlaceholder = usePendingReveal(!loaded);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; closeButton.current?.focus(); return () => previous?.focus(); }, []);
  useEffect(() => {
    let active = true; let initial = true; let timer: ReturnType<typeof setTimeout>;
    async function load() {
      if (!active) return;
      if (!initial && document.hidden) { timer = setTimeout(load, 5000); return; }
      initial = false;
      try { const next = await api.channelMessages(channel.id, parent.id); if (active) { setMessages(next); loadedMessages(next); setLoaded(true); setError(undefined); } }
      catch (reason) { if (active) { setLoaded(true); setError(formatUserError(reason)); } }
      finally { if (active) timer = setTimeout(load, 5000); }
    }
    void load(); return () => { active = false; clearTimeout(timer); };
  }, [api, channel.id, parent.id, revision, loadedMessages]);
  const excerpt = parent.content.replace(/\s+/g, " ").trim();
  return <aside className="channel-thread" aria-label="Channel thread" style={{ width }}><div className="channel-thread-rail" onPointerDown={resize} title="Drag to resize thread" /><header className="channel-room-header"><div><h3>Thread</h3><p title={excerpt}>#{channel.name}{excerpt ? ` · ${excerpt}` : ""}</p></div><button ref={closeButton} className="icon-btn" aria-label="Close thread" onClick={close}><XIcon size={16} /></button></header><Failure error={error} />
    <ChannelFeed messages={messages} members={members} loaded={loaded} empty={!error && <p className="channels-hint">No messages are available in this thread.</p>} />
    {showComposerPlaceholder ? <ComposerSkeleton /> : null}
    <ChannelComposer api={api} channel={channel} members={members} parentId={parent.id} drafts={drafts} hold={!loaded} sent={() => setRevision((value) => value + 1)} />
  </aside>;
}

function MemberPanel({ api, channelId, members, changed }: { api: Api; channelId: string; members: ChannelMember[]; changed: () => void }) {
  const [pubkey, setPubkey] = useState("");
  const [role, setRole] = useState<"member" | "bot">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState<ChannelMember>();
  const [query, setQuery] = useState("");
  const filtered = members.filter((member) => `${member.name} ${member.role} ${member.pubkey}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="channel-members"><label className="channel-search"><SearchIcon size={15} /><input type="search" aria-label="Search channel members" placeholder="Find people and agents" value={query} onChange={(event) => setQuery(event.target.value)} /></label><p className="channels-hint">Members · {members.length}</p><ul>{filtered.map((member) => <li key={member.pubkey}><ChannelProfile className="channel-member-identity" member={member} avatar={<ChannelAvatar member={member} identity={member.pubkey} />}><ChannelAvatar member={member} identity={member.pubkey} /><span>{member.name}<small className="channel-member-role">{member.role === "bot" ? "Agent · External host" : member.role}</small></span></ChannelProfile><button className="icon-btn" disabled={busy} aria-label={`Remove ${member.name}`} title="Remove member" onClick={() => { setError(undefined); setRemoving(member); }}><XIcon size={13} /></button></li>)}</ul>{!filtered.length && <p className="channels-hint">No matching members.</p>}
    {removing && <div className="channel-remove-confirm"><p>Remove <strong>{removing.name}</strong> from this channel? The relay checks your permission.</p><div className="channel-actions"><button className="ghost" disabled={busy} onClick={() => setRemoving(undefined)}>Cancel</button><button className="ghost" disabled={busy} onClick={() => {
      setBusy(true); setError(undefined);
      void api.removeChannelMember(channelId, removing.pubkey).then(() => { setRemoving(undefined); changed(); }, (reason) => setError(formatUserError(reason))).finally(() => setBusy(false));
    }}>Remove member</button></div></div>}
    <Failure error={error} />
    <details><summary>Invite a person or agent<ChevronDownIcon size={14} /></summary>
    <form className="channel-form" onSubmit={(event) => { event.preventDefault(); if (busy) return; setBusy(true); setError(undefined); void api.inviteChannelMember({ channelId, pubkey, role }).then(() => { setPubkey(""); changed(); }, (reason) => setError(formatUserError(reason))).finally(() => setBusy(false)); }}>
      <label>Invite by public key<input value={pubkey} onChange={(event) => setPubkey(event.target.value)} maxLength={64} pattern="[a-fA-F0-9]{64}" required placeholder="64-character public key" /></label>
      <label>Member type<select value={role} onChange={(event) => setRole(event.target.value as "member" | "bot")}><option value="member">Person</option><option value="bot">Existing agent</option></select></label>
      <p className="channels-hint">Invitations require permission on the relay. Adding an agent does not provision a host or grant it access to local files.</p><button className="ghost" disabled={busy}>{busy ? "Working…" : "Invite"}</button>
    </form>
    </details>
  </div>;
}
