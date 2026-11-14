import { useCallback, useEffect, useRef, useState } from "react";
import { SHARE_LINK_EXPIRY_LABEL, type RemoteAccessStatus, type ShareGrant, type ShareLinkExpiry } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useModalFocus } from "../../lib/modal-focus";
import { useWorkspace } from "../../lib/workspace";
import { AlertTriangleIcon, CheckIcon, CopyIcon } from "../shell/icons";
import { copyText } from "./copy-text";
import { shareLinkTiming } from "./share-time";

const EXPIRIES: ShareLinkExpiry[] = ["1h", "1d", "7d", "never"];

/* Remote access status and this thread's (or every thread's) working links, kept fresh by the host's change ping. */
export function useShareLinks(sessionId?: string) {
  const { api } = useWorkspace();
  const [status, setStatus] = useState<RemoteAccessStatus>();
  const [links, setLinks] = useState<ShareGrant[]>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    void Promise.resolve().then(() => Promise.all([api.remoteStatus() as Promise<RemoteAccessStatus>, api.listShareLinks(sessionId)]))
      .then(([nextStatus, nextLinks]) => { setStatus(nextStatus); setLinks(nextLinks); setError(undefined); })
      .catch((failure: unknown) => setError(formatUserError(failure)));
  }, [api, sessionId]);
  useEffect(load, [load]);
  useEffect(() => {
    const off = api.on("state", (event) => {
      if (event && typeof event === "object" && "command" in event && event.command === "remote-updated") load();
    });
    return () => { off(); };
  }, [api, load]);
  return { status, links, error, setError, reload: load };
}

export function ShareDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { api, sessions, updateSettings, setView } = useWorkspace();
  const dialog = useRef<HTMLDivElement>(null);
  const { status, links, error, setError, reload } = useShareLinks(sessionId);
  const [expiry, setExpiry] = useState<ShareLinkExpiry>("1d");
  const [created, setCreated] = useState<{ url: string; copied: boolean }>();
  const [busy, setBusy] = useState<"create" | "enable" | string>();
  useModalFocus(dialog, true, onClose, "[data-primary]");
  const title = sessions.find((item) => item.id === sessionId)?.title ?? "this conversation";
  const off = status?.reach === "off" || (status && !status.url);

  const create = () => {
    setBusy("create");
    setError(undefined);
    void api.createShareLink(sessionId, expiry)
      .then(async (link) => {
        setCreated({ url: link.url, copied: false });
        await copyText(link.url).then(() => setCreated({ url: link.url, copied: true }), () => undefined);
        reload();
      })
      .catch((failure: unknown) => setError(formatUserError(failure)))
      .finally(() => setBusy(undefined));
  };

  const enable = () => {
    setBusy("enable");
    setError(undefined);
    void updateSettings({ remoteAccess: "loopback" }).then(reload, (failure: unknown) => setError(formatUserError(failure))).finally(() => setBusy(undefined));
  };

  const revoke = (id: string) => {
    setBusy(id);
    void api.revokeShareLink(id).then(reload, (failure: unknown) => setError(formatUserError(failure))).finally(() => setBusy(undefined));
  };

  return (
    <div className="palette-backdrop center" onClick={onClose}>
      <div className="dialog share-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="share-title" aria-describedby="share-lede" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <h3 id="share-title">Share read-only link</h3>
        <p id="share-lede" className="share-dialog-lede">
          Anyone with the link can read <b>{title}</b>: its messages, tool activity and changes. Nothing else on this computer, and they cannot send anything.
        </p>

        {status && off ? (
          <div className="share-notice" role="note">
            <AlertTriangleIcon size={14} />
            <div>
              <p>Browser access is off, so nothing can open a link yet.</p>
              <div className="share-notice-actions">
                <button type="button" className="send" data-primary disabled={busy === "enable"} onClick={enable}>{busy === "enable" ? "Turning on…" : "Turn on for this computer"}</button>
                <button type="button" className="ghost" onClick={() => { onClose(); setView("settings"); }}>Browser access settings</button>
              </div>
            </div>
          </div>
        ) : status ? (
          <>
            <p className="share-reach">{status.reach === "network"
              ? "Devices on your network can open it while Capsule is running."
              : "Opens on this computer only. To reach another device, choose This network in Browser access settings."}</p>
            <div className="share-expiry" role="radiogroup" aria-label="Link expires after">
              <span className="share-expiry-label">Expires after</span>
              {EXPIRIES.map((value) => (
                <label key={value} className={`share-expiry-option${expiry === value ? " selected" : ""}`}>
                  <input type="radio" name="share-expiry" value={value} checked={expiry === value} onChange={() => setExpiry(value)} />
                  {SHARE_LINK_EXPIRY_LABEL[value]}
                </label>
              ))}
            </div>
            {created ? (
              <div className="share-created">
                <input className="share-url mono" readOnly value={created.url} aria-label="Share link" onFocus={(event) => event.currentTarget.select()} />
                <button type="button" className="ghost share-copy" onClick={() => void copyText(created.url).then(() => setCreated({ ...created, copied: true }), (failure: unknown) => setError(formatUserError(failure)))}>
                  {created.copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}{created.copied ? "Copied" : "Copy link"}
                </button>
              </div>
            ) : null}
            <p className="share-hint">The link is shown once. Keep it private; revoke it here or in Settings.</p>
          </>
        ) : <p className="share-reach">Checking remote access…</p>}

        {error && <p className="share-error" role="alert">{error}</p>}

        <div className="share-links-heading">Active links</div>
        {links === undefined ? <p className="share-empty">Loading…</p>
          : links.length === 0 ? <p className="share-empty">No active links for this conversation.</p>
          : <ul className="share-links" aria-label="Active links">
            {links.map((link) => (
              <li key={link.id}>
                <span className="share-link-meta">{shareLinkTiming(link)}</span>
                <button type="button" className="ghost share-revoke" disabled={busy === link.id} onClick={() => revoke(link.id)}>{busy === link.id ? "Revoking…" : "Revoke"}</button>
              </li>
            ))}
          </ul>}

        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>Done</button>
          {!off && status && <button type="button" className="send" data-primary disabled={busy === "create"} onClick={create}>{busy === "create" ? "Creating…" : created ? "Create another link" : "Create link"}</button>}
        </div>
      </div>
    </div>
  );
}
