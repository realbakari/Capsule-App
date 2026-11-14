import { useEffect, useRef } from "react";
import { projectAllowsAgentStarts, type Project } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { SparkIcon } from "../shell/icons";
import "./agent-tasks.css";

/** Per project: whether tasks an agent creates may start, and which agents can create them at all. */
export function AgentTasksSetting({ project }: { project: Project }) {
  const { settings, updateSettings, setNotice } = useWorkspace();
  const details = useRef<HTMLDetailsElement>(null);
  const allowed = projectAllowsAgentStarts(settings?.agentTaskAutoStart, project.id);
  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (details.current?.open && !details.current.contains(event.target as Node)) details.current.open = false;
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);
  const toggle = (on: boolean) => {
    const others = (settings?.agentTaskAutoStart ?? []).filter((id) => id !== project.id);
    void updateSettings({ agentTaskAutoStart: on ? [...others, project.id] : others }).catch((error: unknown) => setNotice(formatUserError(error)));
  };
  return (
    <details className="board-agent-tasks" ref={details}>
      <summary className="chip">
        <SparkIcon size={13} />
        <span>Agent tasks: {allowed ? "start on their own" : "drafts"}</span>
      </summary>
      <div className="board-agent-tasks-panel" role="group" aria-label={`Agent tasks in ${project.name}`}>
        <label className="board-agent-tasks-switch">
          <input type="checkbox" checked={allowed} onChange={(event) => toggle(event.target.checked)} />
          <span>Let agents start the tasks they create in {project.name}</span>
        </label>
        <p>{allowed
          ? "A task an agent creates starts at once, or when the cards it waits for are done."
          : "A task an agent creates waits in Draft until you start it. Nothing runs without you."}</p>
        <p className="muted">Agents in direct mode that accept Capsule's tools can create tasks. Claude Code, Codex and Muse Code in direct mode, and threads on the OpenClaw Gateway, do not get these tools yet.</p>
      </div>
    </details>
  );
}
