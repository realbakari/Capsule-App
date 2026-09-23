import { useEffect, useRef, useState } from "react";
import type { ChannelManagementAction, ChannelMember, SharedChannel, SharedChannelDetails } from "@capsule/shared";
import { ChannelAvatar } from "./ChannelMessages";
import { formatUserError } from "../../lib/errors";
import { ArchiveIcon, HashIcon, LockIcon, TrashIcon, XIcon } from "../shell/icons";

type Api = typeof window.capsule;
export function ChannelDetails({ api, channel, members, close, showMembers, changed }: {
  api: Api; channel: SharedChannel; members: ChannelMember[]; close: () => void; showMembers: () => void; changed: () => Promise<void>;
}) {
  const [details, setDetails] = useState<SharedChannelDetails>();
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description);
  const [confirm, setConfirm] = useState<ChannelManagementAction | "leave">();
  const [confirmation, setConfirmation] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const previous = document.activeElement as HTMLElement | null; closeButton.current?.focus();
    return () => { active.current = false; if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let current = true; setLoaded(false);
    void api.sharedChannelDetails(channel.id, channel.name).then((value) => { if (current) { setDetails(value); setLoaded(true); } }, (reason) => { if (current) { setLoaded(true); setError(formatUserError(reason)); } });
    return () => { current = false; };
  }, [api, channel.id, channel.name, revision]);
  async function perform(action: () => Promise<void>, message: string, leave = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(undefined); setNotice("");
    try {
      await action();
      if (!active.current) return;
      setConfirm(undefined); setEditing(false); setNotice(message);
      // The write is accepted even if refreshing the directory subsequently fails.
      await changed();
      if (active.current) { if (leave) close(); else setRevision((value) => value + 1); }
    } catch (reason) { if (active.current) setError(formatUserError(reason)); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  }
  const actionLabel = confirm === "delete" ? "Delete channel" : confirm === "archive" ? "Archive channel" : confirm === "unarchive" ? "Unarchive channel" : "Leave channel";
  return <aside className="channel-thread channel-details" aria-label="Channel settings">
    <header className="channel-room-header"><h3>Channel settings</h3><button ref={closeButton} className="icon-btn" disabled={busy} aria-label="Close channel settings" onClick={close}><XIcon size={16} /></button></header>
    <div className="channel-member-content">
      <div className="channel-details-heading"><span className="channel-welcome-mark" aria-hidden="true">{details?.visibility === "private" ? <LockIcon size={30} /> : <HashIcon size={30} />}</span><h2>{channel.name}</h2><p>{channel.description}</p></div>
      {error && <p className="channels-error" role="alert">{error}</p>}{notice && <p className="channels-hint" role="status">{notice}</p>}
      {!loaded ? <p className="channels-hint" role="status">Loading channel details…</p> : <dl className="channel-facts">
        <div><dt>Visibility</dt><dd>{details?.visibility === "private" ? "Private" : details?.visibility === "public" ? "Public" : "Not reported by the relay"}</dd></div>
        <div><dt>Channel type</dt><dd>{details?.channelType === "stream" ? "Ongoing" : details?.channelType === "forum" ? "Forum" : details?.channelType ?? "Not reported by the relay"}</dd></div>
        <div><dt>Status</dt><dd>{details ? details.archived ? "Archived" : "Active" : "Not reported by the relay"}</dd></div>
        <div><dt>Members</dt><dd><button className="channel-member-preview" disabled={busy} onClick={showMembers}><span>{members.length} members</span><span className="channel-reply-avatars">{members.slice(0, 3).map((member) => <ChannelAvatar key={member.pubkey} identity={member.pubkey} member={member} />)}</span></button></dd></div>
        {details?.topic && <div><dt>Topic</dt><dd>{details.topic}</dd></div>}{details?.purpose && <div><dt>Purpose</dt><dd>{details.purpose}</dd></div>}
        <div><dt>Channel ID</dt><dd className="channel-id">{channel.id}</dd></div>
      </dl>}
      <button className="ghost" disabled={busy} onClick={() => { setError(undefined); setRevision((value) => value + 1); }}>Refresh details</button>
      {editing ? <form className="channel-form" onSubmit={(event) => { event.preventDefault(); void perform(() => api.updateSharedChannel({ channelId: channel.id, name, description }), "Channel details saved."); }}>
        <label>Name<input value={name} disabled={busy} maxLength={80} required onChange={(event) => setName(event.target.value)} /></label>
        <label>Description<input value={description} disabled={busy} maxLength={1000} onChange={(event) => setDescription(event.target.value)} /></label>
        <div className="channel-actions"><button className="ghost" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel editing</button><button className="primary" disabled={busy || !name.trim()}>Save details</button></div>
      </form> : <div className="channel-management">
        <button disabled={busy || !!confirm} onClick={() => { setName(channel.name); setDescription(channel.description); setEditing(true); }}>Edit details</button>
        {channel.joined && <button disabled={busy || !!confirm} onClick={() => setConfirm("leave")}>Leave channel</button>}
        {details && <button disabled={busy || !!confirm} onClick={() => setConfirm(details.archived ? "unarchive" : "archive")}><ArchiveIcon size={18} />{details.archived ? "Unarchive channel" : "Archive channel"}</button>}
        <button className="channel-destructive" disabled={busy || !!confirm} onClick={() => { setConfirmation(""); setConfirm("delete"); }}><TrashIcon size={18} />Delete channel</button>
      </div>}
      {confirm && <form className="channel-form channel-remove-confirm" onSubmit={(event) => {
        event.preventDefault();
        if (confirm === "delete" && confirmation !== channel.name) return;
        void perform(() => confirm === "leave" ? api.channelMembership(channel.id, "leave") : api.manageSharedChannel(channel.id, confirm), `${actionLabel} accepted.`, confirm === "delete" || confirm === "leave");
      }}><strong>{actionLabel}?</strong><p>{confirm === "delete" ? "This permanently deletes the shared channel for everyone. This cannot be undone here." : confirm === "leave" ? "You may need another invitation to return to a private channel." : confirm === "archive" ? "Archive this channel for all members. It can be unarchived from settings." : "Make this channel active again for its members."}</p>
        {confirm === "delete" && <label>Type {channel.name} to confirm<input autoFocus value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>}
        <div className="channel-actions"><button type="button" className="ghost" disabled={busy} onClick={() => setConfirm(undefined)}>Cancel</button><button className="ghost" disabled={busy || (confirm === "delete" && confirmation !== channel.name)}>{busy ? "Working…" : `Confirm ${confirm}`}</button></div>
      </form>}
      <p className="channels-hint">Changes apply to the shared channel. The relay checks your permissions.</p>
    </div>
  </aside>;
}
