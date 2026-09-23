import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ChannelMember } from "@capsule/shared";
import { XIcon } from "../shell/icons";

/** Profile data belongs to the relay. Do not invent host readiness or models. */
export function ChannelProfile({ member, avatar, children, className = "" }: { member: ChannelMember; avatar: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  function close() { setOpen(false); trigger.current?.focus(); }
  return <>
    <button ref={trigger} type="button" className={`channel-profile-trigger ${className}`} aria-label={`View ${member.name} profile`} aria-haspopup="dialog" onClick={() => { setCopied(""); setOpen(true); }}>{children}</button>
    {open && createPortal(<dialog ref={dialog} className="channel-profile-dialog" aria-label={`${member.name} profile`} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section><header><strong>Profile</strong><button autoFocus type="button" className="icon-btn" aria-label="Close profile" onClick={close}><XIcon size={18} /></button></header>
        <div className="channel-profile-heading">{avatar}<h2>{member.name}</h2><span>{member.role === "bot" ? "Agent · External host" : member.role}</span></div>
        <dl className="channel-facts"><div><dt>Public key</dt><dd className="channel-id">{member.pubkey}</dd></div></dl>
        <button type="button" className="ghost" onClick={() => { void navigator.clipboard.writeText(member.pubkey).then(() => setCopied("Public key copied."), () => setCopied("Could not copy the public key.")); }}>Copy public key</button>
        {copied && <p role="status">{copied}</p>}
        {member.role === "bot" && <div className="channel-agent-host"><strong>Runs outside Capsule</strong><p>Channel messages go to this agent’s separately configured host, not your local Capsule harness.</p><p>If it does not reply, check its host’s activity log, model support, and runtime version. Capsule cannot inspect or restart that host.</p></div>}
      </section>
    </dialog>, document.body)}
  </>;
}
