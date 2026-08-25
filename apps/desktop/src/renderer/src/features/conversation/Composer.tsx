import { MODES, useWorkspace } from "../../lib/workspace";

export function Composer() {
  const {
    draft,
    setDraft,
    send,
    busy,
    mode,
    setMode,
    agentId,
    setAgentId,
    agents,
    session,
    project,
    steerDraft,
    setSteerDraft,
    steerHarness,
  } = useWorkspace();
  const harnessLive = Boolean(session?.harnessId && session.harnessState && session.harnessState !== "closed");

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          value={draft}
          placeholder={
            harnessLive
              ? `Continue with ${session?.harnessId === "codex" ? "Codex" : "Claude Code"}…`
              : "Ask Capsule to work on something…"
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {harnessLive && (
          <div className="composer-row">
            <input
              type="text"
              placeholder="Steer the in-flight turn without replacing context"
              value={steerDraft}
              onChange={(event) => setSteerDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void steerHarness();
                }
              }}
            />
            <button className="chip" disabled={!steerDraft.trim()} onClick={() => void steerHarness()}>
              Steer
            </button>
          </div>
        )}
        <div className="composer-row">
          <div className="chips">
            <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
              {MODES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
              {agents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            {project?.defaultAgentId && (
              <span className="chip">
                {project.defaultAgentId === "codex" ? "Codex" : "Claude Code"} dedicated
              </span>
            )}
          </div>
          <button className="send" disabled={busy || !draft.trim()} onClick={() => void send()}>
            Send →
          </button>
        </div>
      </div>
    </div>
  );
}
