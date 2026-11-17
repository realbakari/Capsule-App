import type { ApprovalRequest, Session } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { SkillsDirectory } from "./SkillsDirectory";
import { ApprovalCards } from "../conversation/ApprovalCards";

export function SkillsView() {
  return (
    <section className="panel skills-panel">
      <div className="panel-inner">
        <SkillsDirectory />
      </div>
    </section>
  );
}

/**
 * Every request waiting on the user, grouped by the conversation that asked,
 * with the same cards the conversation shows so the two answer alike.
 */
export function ApprovalsView() {
  const { api, approvals, sessions, projects, setProjectId, setView } = useWorkspace();
  const readOnly = api.isDesktop === false && api.remoteMode !== "control";
  const byThread = new Map<string, ApprovalRequest[]>();
  for (const item of approvals) {
    if (item.status !== "pending") continue;
    const key = item.sessionId ?? "";
    byThread.set(key, [...(byThread.get(key) ?? []), item]);
  }
  const open = (session: Session, focus = false) => {
    setProjectId(session.projectId, session.id);
    setView("chat");
    if (focus) requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer-dock textarea.composer-field")?.focus()));
  };
  return (
    <section className="panel">
      <div className="panel-inner approvals-page">
        {byThread.size === 0 && <p className="muted">Nothing is waiting on you. When an agent asks to run a command or edit outside its permissions, the request appears here and in its conversation.</p>}
        {[...byThread].map(([sessionId, requests]) => {
          const session = sessions.find((item) => item.id === sessionId);
          const project = projects.find((item) => item.id === session?.projectId);
          return (
            <section key={sessionId || "none"} className="approvals-thread" aria-label={session ? `Waiting in ${session.title}` : "Waiting"}>
              <header className="approvals-thread-head">
                <span className="approvals-thread-name">
                  <strong>{session?.title ?? "A conversation that is no longer listed"}</strong>
                  {project && <span className="faint">{project.name}</span>}
                </span>
                {session && <button type="button" className="ghost" onClick={() => open(session)}>Open conversation</button>}
              </header>
              <ApprovalCards requests={requests} session={session} readOnly={readOnly} onReply={session ? () => open(session, true) : () => undefined} />
            </section>
          );
        })}
      </div>
    </section>
  );
}
