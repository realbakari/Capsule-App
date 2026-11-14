import { useState } from "react";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { useThreadPresence } from "./Presence";
import { useShareLinks } from "./ShareDialog";
import { shareLinkTiming, sinceLabel } from "./share-time";
import "./share.css";

/** Settings › Remote access: who is connected right now, and every working share link. */
export function ShareSettings() {
  const { api, sessions, setProjectId, setView } = useWorkspace();
  const { links, error, setError, reload } = useShareLinks();
  const presence = useThreadPresence();
  const [revoking, setRevoking] = useState<string>();
  const titleOf = (id: string) => sessions.find((item) => item.id === id)?.title ?? "A deleted conversation";
  const open = (id: string) => {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    setProjectId(session.projectId, session.id);
    setView("chat");
  };
  const viewing = presence.flatMap((thread) => thread.viewers.map((viewer) => ({ ...viewer, sessionId: thread.sessionId })));

  return (
    <div className="share-settings">
      <div className="nav-label share-settings-label">Connected now</div>
      {viewing.length === 0 ? <p className="faint">No device is viewing a conversation.</p> : (
        <ul className="share-settings-list" aria-label="Connected now">
          {viewing.map((viewer, index) => (
            <li key={`${viewer.sessionId}-${index}`}>
              <div>
                <b>{viewer.label}</b>
                <div className="faint">Viewing <button type="button" className="share-thread-link" onClick={() => open(viewer.sessionId)}>{titleOf(viewer.sessionId)}</button> · {sinceLabel(viewer.since)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="nav-label share-settings-label">Share links</div>
      {error && <p className="settings-keybind-error">{error}</p>}
      {links === undefined ? <p className="faint">Loading…</p> : links.length === 0 ? (
        <p className="faint">None. Share a conversation from its title menu.</p>
      ) : (
        <ul className="share-settings-list" aria-label="Share links">
          {links.map((link) => (
            <li key={link.id}>
              <div>
                <button type="button" className="share-thread-link strong" onClick={() => open(link.sessionId)}>{titleOf(link.sessionId)}</button>
                <div className="faint">Read only · {shareLinkTiming(link)}</div>
              </div>
              <button className="danger" type="button" disabled={revoking === link.id} onClick={() => {
                setRevoking(link.id);
                void api.revokeShareLink(link.id).then(reload, (failure: unknown) => setError(formatUserError(failure))).finally(() => setRevoking(undefined));
              }}>{revoking === link.id ? "Revoking…" : "Revoke"}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
